import { SENSITIVE_ZONES, RESPONSE_RESOURCES, HISTORICAL_INCIDENTS, LAYER_META } from "./data";
import { compass, destination, haversineKm, toDeg, toRad } from "./geo";
import type {
  DriftForecast,
  ExposureEstimate,
  HistoricalIncident,
  ImpactAssessment,
  Incident,
  ManpowerEstimate,
  ResponsePlan,
  RiskLevel,
  SimilarMatch,
  Telemetry,
} from "./types";

export const WINDAGE_COEFFICIENT = 0.03;
export const FORECAST_HOURS = [0, 6, 12, 24, 48, 72];

/** Convert a speed + compass direction ("toward" convention) into u/v components. */
function components(speed: number, directionDeg: number) {
  return {
    u: speed * Math.sin(toRad(directionDeg)),
    v: speed * Math.cos(toRad(directionDeg)),
  };
}

export interface DriftInput {
  lat: number;
  lon: number;
  currentSpeed: number;
  currentDirection: number;
  windSpeed: number;
  windDirection: number;
  windage?: number | undefined;
  spillAreaKm2: number;
}

/**
 * V_oil = V_current + Cw * V_wind, integrated forward with a constant field.
 * Position(t + dt) = Position(t) + V_oil * dt
 */
export function calculateDrift(input: DriftInput): DriftForecast {
  const cw = input.windage ?? WINDAGE_COEFFICIENT;
  const cur = components(input.currentSpeed, input.currentDirection);
  const wind = components(input.windSpeed, input.windDirection);
  const uOil = cur.u + cw * wind.u;
  const vOil = cur.v + cw * wind.v;
  const speed = Math.sqrt(uOil ** 2 + vOil ** 2);
  const directionDeg = (toDeg(Math.atan2(uOil, vOil)) + 360) % 360;
  const baseRadius = Math.sqrt(input.spillAreaKm2 / Math.PI);

  const points = FORECAST_HOURS.map((hours) => {
    const distanceKm = (speed * 3.6 * hours);
    const [lat, lon] = destination(input.lat, input.lon, directionDeg, distanceKm);
    return {
      hours,
      lat,
      lon,
      distanceKm,
      // Uncertainty grows with lead time (~12% of travelled distance) plus slick radius.
      uncertaintyKm: baseRadius + distanceKm * 0.12 + hours * 0.05,
    };
  });

  return { uOil, vOil, speed, directionDeg, windageCoefficient: cw, points };
}

export function driftAt(forecast: DriftForecast, hours: number) {
  const sorted = forecast.points;
  const exact = sorted.find((p) => p.hours === hours);
  if (exact) return exact;
  return sorted[sorted.length - 1]!;
}

const LAYER_WEIGHT: Record<string, number> = {
  coastline: 1,
  mangrove: 1.1,
  coral: 1.05,
  mpa: 1.15,
  fishing: 0.8,
};

/** Nearest-approach exposure estimate for each sensitive feature along the drift vector. */
export function calculateExposures(
  incident: Incident,
  forecast: DriftForecast,
): ExposureEstimate[] {
  const speedKmh = forecast.speed * 3.6;
  const near = (path: [number, number][]) =>
    Math.min(...path.map((p) => haversineKm([incident.lat, incident.lon], p)));

  return SENSITIVE_ZONES.map((zone) => {
    const distanceKm = near(zone.path);
    // Only count features broadly downstream of the drift vector.
    const bearingToZone = zone.path.reduce((best, p) => {
      const d = haversineKm([incident.lat, incident.lon], p);
      return d < best.d ? { d, p } : best;
    }, { d: Infinity, p: zone.path[0]! });
    const dLat = bearingToZone.p[0] - incident.lat;
    const dLon = bearingToZone.p[1] - incident.lon;
    const zoneBearing = (toDeg(Math.atan2(dLon, dLat)) + 360) % 360;
    let delta = Math.abs(zoneBearing - forecast.directionDeg);
    if (delta > 180) delta = 360 - delta;

    const alongTrack = distanceKm / Math.max(0.05, Math.cos(toRad(Math.min(delta, 89))));
    const hours = speedKmh > 0.01 && delta < 75 ? alongTrack / speedKmh : null;
    const severity: RiskLevel =
      hours === null
        ? "LOW"
        : hours <= 18
          ? "CRITICAL"
          : hours <= 30
            ? "HIGH"
            : hours <= 48
              ? "MEDIUM"
              : "LOW";
    return {
      feature: LAYER_META[zone.layer].label.replace(/s$/, ""),
      hours: hours === null ? null : Math.round(hours),
      distanceKm: Math.round(distanceKm * 10) / 10,
      severity,
    };
  }).sort((a, b) => (a.hours ?? 1e9) - (b.hours ?? 1e9));
}

const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));

export function calculateImpact(
  incident: Incident,
  forecast: DriftForecast,
  exposures = calculateExposures(incident, forecast),
): ImpactAssessment {
  const persistent = incident.persistence === "Persistent";
  const spillHazard = clamp(
    28 + Math.log10(Math.max(1, incident.volumeTonnes)) * 14 + incident.spillAreaKm2 * 1.1,
  );
  const soonest = exposures.find((e) => e.hours !== null)?.hours ?? null;
  const environmentalExposure = clamp(
    soonest === null ? 24 : 100 - Math.min(72, soonest) * 0.95,
  );
  const sensitiveHit = exposures.filter(
    (e) => e.hours !== null && e.hours <= 48 && e.feature !== "Fishing Zone",
  ).length;
  const ecologicalVulnerability = clamp(38 + sensitiveHit * 11 + (persistent ? 8 : 0));
  const persistenceScore = clamp(
    (persistent ? 74 : 38) + Math.min(14, forecast.speed * 28),
  );

  const components = [
    {
      label: "Spill Hazard",
      value: Math.round(spillHazard),
      note: `${incident.volumeTonnes.toLocaleString()} t across ${incident.spillAreaKm2} km²`,
    },
    {
      label: "Environmental Exposure",
      value: Math.round(environmentalExposure),
      note: soonest === null ? "No feature intersected downstream" : `First exposure ≈ ${soonest} h`,
    },
    {
      label: "Ecological Vulnerability",
      value: Math.round(ecologicalVulnerability),
      note: `${sensitiveHit} sensitive habitat(s) in trajectory`,
    },
    {
      label: "Persistence",
      value: Math.round(persistenceScore),
      note: `${incident.persistence} oil, drift ${forecast.speed.toFixed(2)} m/s`,
    },
  ];

  const score = Math.round(
    components.reduce(
      (sum, c, i) => sum + c.value * [0.3, 0.28, 0.24, 0.18][i]!,
      0,
    ),
  );
  const severity: RiskLevel =
    score >= 85 ? "CRITICAL" : score >= 70 ? "HIGH" : score >= 45 ? "MEDIUM" : "LOW";

  const reasoning: { driver: string; effect: string }[] = [];
  reasoning.push(
    persistent
      ? { driver: `${incident.oilType} classified as persistent`, effect: "Higher environmental persistence and weathering time" }
      : { driver: `${incident.oilType} classified as non-persistent`, effect: "Faster evaporation reduces long-term persistence" },
  );
  reasoning.push({
    driver: `Predicted movement ${forecast.speed.toFixed(2)} m/s ${compass(forecast.directionDeg)}`,
    effect: forecast.speed > 0.3 ? "Larger potential exposure area" : "Slower spread, more response time",
  });
  const coast = exposures.find((e) => e.feature === "Coastline");
  if (coast?.hours != null)
    reasoning.push({
      driver: `Trajectory intersects sensitive coastline in ≈ ${coast.hours} h`,
      effect: "Coastal exposure risk increased",
    });
  const mpa = exposures.find((e) => e.feature.startsWith("Marine Protected"));
  if (mpa?.hours != null)
    reasoning.push({
      driver: `Marine Protected Area within predicted trajectory (≈ ${mpa.hours} h)`,
      effect: "Ecological vulnerability increased",
    });
  reasoning.push({
    driver: `Spill area ${incident.spillAreaKm2} km² / ${incident.volumeTonnes.toLocaleString()} t`,
    effect: "Overall hazard increased",
  });

  const confidence = Math.round(
    clamp(
      62 +
        incident.mlConfidence * 22 +
        (incident.telemetry.currentSpeed !== null && incident.telemetry.windSpeed !== null ? 6 : -12),
      35,
      95,
    ),
  );

  return { score, severity, confidence, components, reasoning, exposures };
}

export function estimateManpower(
  incident: Incident,
  impact: ImpactAssessment,
): ManpowerEstimate {
  const coastal = impact.exposures.find((e) => e.feature === "Coastline")?.hours ?? null;
  const volumeFactor = Math.max(1, Math.round(incident.volumeTonnes / 120));
  const roles = [
    { role: "Incident Command", personnel: 2 },
    { role: "Containment Team", personnel: Math.min(24, 4 + volumeFactor * 1.2) },
    {
      role: "Shoreline Protection",
      personnel: coastal !== null && coastal <= 24 ? Math.min(28, 8 + volumeFactor) : 4,
    },
    { role: "Environmental Monitoring", personnel: impact.score >= 70 ? 4 : 2 },
    { role: "Logistics", personnel: 4 },
  ].map((r) => ({ role: r.role, personnel: Math.round(r.personnel) }));
  return { roles, total: roles.reduce((s, r) => s + r.personnel, 0) };
}

export function recommendResources(incident: Incident, impact: ImpactAssessment) {
  const boom = Math.min(12.4, Math.round(Math.sqrt(incident.spillAreaKm2) * 2.3 * 10) / 10);
  const skimmers = Math.max(1, Math.min(8, Math.round(incident.volumeTonnes / 150)));
  const personnel = estimateManpower(incident, impact).total;
  const drones = impact.score >= 70 ? 2 : 1;
  const wildlife = impact.exposures.some((e) => e.hours !== null && e.hours <= 24) ? 2 : 1;
  const avail = (name: string) => {
    const r = RESPONSE_RESOURCES.find((x) => x.resource === name)!;
    return `${r.available} ${r.unit} available`;
  };
  return [
    { resource: "Containment Boom", recommended: `${boom} km`, available: avail("Containment Boom") },
    { resource: "Skimmer Vessels", recommended: `${skimmers}`, available: avail("Skimmer Vessels") },
    { resource: "Response Personnel", recommended: `${personnel}`, available: avail("Response Personnel") },
    { resource: "Monitoring Drones", recommended: `${drones}`, available: avail("Monitoring Drones") },
    { resource: "Wildlife Response Units", recommended: `${wildlife}`, available: avail("Wildlife Response Units") },
  ];
}

export function generateResponsePlan(
  incident: Incident,
  forecast: DriftForecast,
  impact: ImpactAssessment,
): ResponsePlan {
  const dir = compass(forecast.directionDeg);
  const t = incident.telemetry;
  const exp = (name: string) => impact.exposures.find((e) => e.feature.startsWith(name));
  const coast = exp("Coastline");
  const mangrove = exp("Mangrove");
  const fishing = exp("Fishing");
  const mpa = exp("Marine Protected");

  const situation = [
    { label: "Spill", value: `${incident.volumeTonnes.toLocaleString()} tonnes` },
    { label: "Oil", value: `${incident.persistence.toLowerCase()} ${incident.oilType.toLowerCase()}` },
    { label: "Drift", value: `${forecast.speed.toFixed(2)} m/s ${dir}` },
    { label: "Wind", value: t.windSpeed === null ? "Data unavailable" : `${t.windSpeed} m/s ${compass(t.windDirection)}` },
    { label: "Current", value: t.currentSpeed === null ? "Data unavailable" : `${t.currentSpeed} m/s ${compass(t.currentDirection)}` },
    { label: "Coastline exposure", value: coast?.hours != null ? `${coast.hours} hours` : "Not intersected" },
    { label: "MPA exposure", value: mpa?.hours != null ? `${mpa.hours} hours` : "Not intersected" },
    { label: "Mangrove exposure", value: mangrove?.hours != null ? `${mangrove.hours} hours` : "Not intersected" },
  ];

  const actions: ResponsePlan["actions"] = [];
  if (coast?.hours != null && coast.hours <= 36) {
    actions.push({
      rank: 1,
      title: "Protect Coastline",
      priority: coast.hours <= 20 ? "CRITICAL" : "HIGH",
      timing: coast.hours <= 20 ? "Immediately" : `Within ${Math.max(2, Math.round(coast.hours / 3))} hours`,
      reason: `The predicted trajectory indicates coastline exposure within approximately ${coast.hours} hours.`,
      action:
        "Establish shoreline protection and position containment resources along the predicted coastal approach corridor.",
      chain: [
        `${incident.persistence} oil`,
        `${dir} drift`,
        `${forecast.speed.toFixed(2)} m/s movement`,
        `${coast.hours} h coastline exposure`,
        "Sensitive habitat",
        "HIGH COASTAL THREAT",
      ],
    });
  }
  actions.push({
    rank: actions.length + 1,
    title: "Deploy Containment",
    priority: incident.persistence === "Persistent" ? "HIGH" : "MEDIUM",
    timing: "Within 2 hours",
    reason: `${incident.persistence} ${incident.oilType.toLowerCase()} combined with a ${forecast.speed.toFixed(2)} m/s predicted drift increases the probability of continued spread.`,
    action:
      "Deploy containment boom on the down-drift edge of the slick and begin mechanical recovery with skimmer vessels.",
    chain: [
      `${incident.volumeTonnes.toLocaleString()} t release`,
      `${incident.spillAreaKm2} km² slick`,
      `${forecast.speed.toFixed(2)} m/s drift`,
      "CONTINUED SPREAD RISK",
    ],
  });
  if (mangrove?.hours != null && mangrove.hours <= 48) {
    actions.push({
      rank: actions.length + 1,
      title: "Monitor Mangrove Region",
      priority: mangrove.hours <= 24 ? "HIGH" : "MEDIUM",
      timing: `Before T+${Math.max(2, mangrove.hours - 4)} h`,
      reason: `The predicted trajectory may intersect mangrove habitat within approximately ${mangrove.hours} hours.`,
      action:
        "Pre-position exclusion boom at creek mouths and task aerial monitoring of the mangrove fringe.",
      chain: [`${mangrove.hours} h mangrove exposure`, "Persistent oil", "HABITAT VULNERABILITY"],
    });
  }
  if (fishing?.hours != null && fishing.hours <= 60) {
    actions.push({
      rank: actions.length + 1,
      title: "Monitor Fishing Activity",
      priority: "MEDIUM",
      timing: "Within 6 hours",
      reason: `Predicted movement intersects an active fishing region in approximately ${fishing.hours} hours.`,
      action:
        "Issue a navigational and fisheries advisory for the affected sector and coordinate with local authorities.",
      chain: [`${fishing.hours} h fishing zone exposure`, "Active artisanal fleet", "LIVELIHOOD EXPOSURE"],
    });
  }
  if (mpa?.hours != null) {
    actions.push({
      rank: actions.length + 1,
      title: "Notify Marine Protected Area Authority",
      priority: mpa.hours <= 36 ? "HIGH" : "MEDIUM",
      timing: "Within 4 hours",
      reason: `A Marine Protected Area lies within the predicted trajectory (≈ ${mpa.hours} hours).`,
      action: "Notify the protected-area authority and prepare wildlife response units for standby.",
      chain: [`${mpa.hours} h MPA exposure`, "Protected designation", "ECOLOGICAL VULNERABILITY"],
    });
  }
  actions.push({
    rank: actions.length + 1,
    title: "Increase Monitoring Frequency",
    priority: "MEDIUM",
    timing: "Continuous",
    reason:
      "Environmental conditions may change the trajectory. Recalculate the drift forecast every 6 hours.",
    action: "Schedule 6-hourly re-tasking of satellite/drone imagery and refresh telemetry ingestion.",
    chain: ["Model-based forecast", "Variable wind field", "FORECAST UNCERTAINTY"],
  });

  return {
    incidentId: incident.id,
    priority: impact.severity,
    situation,
    actions,
    manpower: estimateManpower(incident, impact),
    resources: recommendResources(incident, impact),
    summary: `I've analyzed ${incident.id}. The spill is currently classified as ${impact.severity} priority. Based on the current wind, ocean current, spill persistence, predicted trajectory and environmental exposure, I have prepared an immediate response plan.`,
  };
}

/* ------------------------------ similarity ------------------------------ */

export function findSimilarIncidents(incident: Incident, limit = 5): SimilarMatch[] {
  const scored = HISTORICAL_INCIDENTS.map((h) => {
    const reasons: string[] = [];
    let score = 0;
    const volRatio =
      Math.min(h.volumeTonnes, incident.volumeTonnes) /
      Math.max(h.volumeTonnes, incident.volumeTonnes);
    score += volRatio * 26;
    if (volRatio > 0.45) reasons.push(`Comparable release volume (${h.volumeTonnes.toLocaleString()} t)`);
    if (h.oilType === incident.oilType) {
      score += 22;
      reasons.push(`Same oil type (${h.oilType})`);
    } else if (h.persistence === incident.persistence) {
      score += 12;
    }
    if (h.persistence === incident.persistence) {
      score += 16;
      reasons.push(`${h.persistence} oil, matching weathering behaviour`);
    }
    if (h.region === incident.region) {
      score += 16;
      reasons.push(`Same marine region (${h.region})`);
    } else {
      const dist = haversineKm([incident.lat, incident.lon], [h.lat, h.lon]);
      score += Math.max(0, 12 - dist / 900);
    }
    if (h.cause === incident.cause) {
      score += 6;
      reasons.push(`Similar reported cause (${h.cause})`);
    }
    if (/mangrove|shoreline/i.test(h.coastalStatus)) {
      score += 10;
      reasons.push("Coastal/habitat oiling recorded — comparable exposure pathway");
    }
    return { historical: h, similarity: Math.round(Math.min(97, score + 4)), reasons };
  });
  return scored.sort((a, b) => b.similarity - a.similarity).slice(0, limit);
}

/* ------------------------------- chatbot -------------------------------- */

export interface ChatContext {
  incident: Incident;
  forecast: DriftForecast;
  impact: ImpactAssessment;
  plan: ResponsePlan;
}

export const SUGGESTED_QUESTIONS = [
  "Why is this high priority?",
  "Why should we protect the coastline first?",
  "How much manpower is required?",
  "What happens if wind speed increases?",
  "Which environmental areas are at risk?",
  "Which historical spills are similar?",
  "What should we monitor next?",
];

export function answerQuestion(question: string, ctx: ChatContext) {
  const q = question.toLowerCase();
  const { incident, forecast, impact, plan } = ctx;
  const dir = compass(forecast.directionDeg);
  const coast = impact.exposures.find((e) => e.feature === "Coastline");
  const t = incident.telemetry;
  const baseMetrics = [
    { label: "Wind", value: t.windSpeed === null ? "Data unavailable" : `${t.windSpeed} m/s ${compass(t.windDirection)}` },
    { label: "Current", value: t.currentSpeed === null ? "Data unavailable" : `${t.currentSpeed} m/s ${compass(t.currentDirection)}` },
    { label: "Drift", value: `${forecast.speed.toFixed(2)} m/s ${dir}` },
    { label: "Coastline exposure", value: coast?.hours != null ? `${coast.hours}h` : "Not intersected" },
    { label: "Oil persistence", value: incident.persistence },
  ];

  if (/manpower|personnel|staff|team size|how many people/.test(q)) {
    return {
      text: `For the current classification (${impact.severity}, impact score ${impact.score}/100) the planning estimate for the immediate response phase is ${plan.manpower.total} personnel. Shoreline protection dominates the requirement because coastline exposure is estimated at ${coast?.hours ?? "—"} hours. These figures are planning estimates and must be validated against actual operational capability.`,
      table: plan.manpower.roles.map((r) => ({ label: r.role, value: `${r.personnel} personnel` })),
      metrics: [{ label: "Total estimated personnel", value: `${plan.manpower.total}` }],
    };
  }
  if (/coastline first|protect the coast|why coast/.test(q)) {
    return {
      text: `The current drift estimate is ${forecast.speed.toFixed(2)} m/s toward the ${dir.toLowerCase()}, while the predicted trajectory indicates potential coastline exposure in approximately ${coast?.hours ?? "—"} hours. Because the oil is classified as ${incident.persistence.toLowerCase()} and the affected coastal region contains sensitive environmental areas, shoreline protection has been ranked as the highest-priority action.`,
      metrics: baseMetrics,
      chain: plan.actions[0]?.chain,
    };
  }
  if (/high priority|why.*(high|severity|priority)|impact score/.test(q)) {
    return {
      text: `${incident.id} scores ${impact.score}/100 (${impact.severity}) on the environmental severity model with ${impact.confidence}% confidence. The score is driven by ${impact.components.map((c) => `${c.label} ${c.value}`).join(", ")}. In plain terms: ${impact.reasoning.map((r) => r.driver.toLowerCase()).join("; ")}.`,
      table: impact.components.map((c) => ({ label: c.label, value: `${c.value}` })),
      chain: impact.reasoning.map((r) => `${r.driver} → ${r.effect}`),
    };
  }
  if (/wind.*(increase|stronger|\+|gust)/.test(q)) {
    const stronger = calculateDrift({
      lat: incident.lat,
      lon: incident.lon,
      currentSpeed: t.currentSpeed ?? 0,
      currentDirection: t.currentDirection ?? 0,
      windSpeed: (t.windSpeed ?? 0) * 1.3,
      windDirection: t.windDirection ?? 0,
      spillAreaKm2: incident.spillAreaKm2,
    });
    const newCoast = calculateExposures({ ...incident }, stronger).find((e) => e.feature === "Coastline");
    return {
      text: `A 30% increase in wind speed raises the windage contribution (Cw = ${forecast.windageCoefficient}) and lifts the combined drift from ${forecast.speed.toFixed(2)} m/s to ${stronger.speed.toFixed(2)} m/s. Estimated coastline exposure would shift from ≈ ${coast?.hours ?? "—"} h to ≈ ${newCoast?.hours ?? "—"} h, compressing the available preparation window. You can explore this in the What-If simulator.`,
      metrics: [
        { label: "Current drift", value: `${forecast.speed.toFixed(2)} m/s ${dir}` },
        { label: "Wind +30% drift", value: `${stronger.speed.toFixed(2)} m/s ${compass(stronger.directionDeg)}` },
        { label: "Coastline now", value: coast?.hours != null ? `${coast.hours}h` : "—" },
        { label: "Coastline wind +30%", value: newCoast?.hours != null ? `${newCoast.hours}h` : "—" },
      ],
    };
  }
  if (/environmental areas|at risk|exposure|habitat/.test(q)) {
    return {
      text: `Based on the predicted trajectory, the following sensitive features fall within the modelled exposure envelope. Times are nearest-approach estimates using the combined drift vector and should be re-validated every 6 hours.`,
      table: impact.exposures.map((e) => ({
        label: e.feature,
        value: e.hours != null ? `${e.hours} h (${e.distanceKm} km)` : "Not intersected",
      })),
    };
  }
  if (/historical|similar|precedent|past spill/.test(q)) {
    const matches = findSimilarIncidents(incident, 3);
    return {
      text: `The closest historical analogues by volume, oil type, persistence and regional context are listed below. Similarity is a heuristic comparison, not a scientific equivalence.`,
      table: matches.map((m) => ({
        label: `${m.similarity}% — ${m.historical.name}`,
        value: m.reasons[0] ?? m.historical.location,
      })),
    };
  }
  if (/monitor next|what.*next|next step/.test(q)) {
    return {
      text: `Next monitoring priorities: (1) re-task imagery over the down-drift corridor before T+6h, (2) confirm shoreline resource positioning against the ${coast?.hours ?? "—"} h coastal estimate, (3) refresh wind and current telemetry — the forecast is only as good as the field it was built on, and (4) log any observed slick boundary so the model can be corrected.`,
      metrics: baseMetrics,
    };
  }
  if (/containment|boom|skimmer|resource/.test(q)) {
    return {
      text: `Recommended planning allocation for the immediate phase, matched against declared availability:`,
      table: plan.resources.map((r) => ({ label: r.resource, value: `${r.recommended} (${r.available})` })),
    };
  }
  return {
    text: `Here is the current picture for ${incident.id}: ${impact.severity} priority (${impact.score}/100), ${incident.volumeTonnes.toLocaleString()} t of ${incident.persistence.toLowerCase()} ${incident.oilType.toLowerCase()}, drifting at ${forecast.speed.toFixed(2)} m/s toward the ${dir.toLowerCase()}. The top-ranked action is "${plan.actions[0]?.title}" — ${plan.actions[0]?.reason} Ask me about priority, coastline protection, manpower, resources, exposure, wind sensitivity or historical analogues.`,
    metrics: baseMetrics,
  };
}

/* -------------------------- convenience bundle -------------------------- */

export function buildIntelligence(incident: Incident) {
  const t: Telemetry = incident.telemetry;
  const forecast = calculateDrift({
    lat: incident.lat,
    lon: incident.lon,
    currentSpeed: t.currentSpeed ?? 0,
    currentDirection: t.currentDirection ?? 0,
    windSpeed: t.windSpeed ?? 0,
    windDirection: t.windDirection ?? 0,
    spillAreaKm2: incident.spillAreaKm2,
  });
  const impact = calculateImpact(incident, forecast);
  const plan = generateResponsePlan(incident, forecast, impact);
  return { forecast, impact, plan };
}

export function similarityOf(h: HistoricalIncident, incident: Incident) {
  return findSimilarIncidents(incident, HISTORICAL_INCIDENTS.length).find(
    (m) => m.historical.id === h.id,
  );
}
