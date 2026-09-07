"""Wire models for the OILY API.

Field names are camelCase to drop straight into the web client's existing
TypeScript types (src/lib/oily/types.ts) with no translation layer — the same
principle the detection endpoint already follows. Request bodies the client
sends use the same convention.
"""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field

RiskLevel = Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"]
DataStatus = Literal["OBSERVED", "MODELLED", "ESTIMATED", "SIMULATED"]
IncidentStatus = Literal[
    "DETECTED", "CLASSIFIED", "CONFIRMED", "ANALYZING", "RESPONDING", "CONTAINED", "CLOSED"
]


# --------------------------------------------------------------------------
# Incident + environment
# --------------------------------------------------------------------------
class Telemetry(BaseModel):
    currentSpeed: Optional[float] = None
    currentDirection: Optional[float] = None
    windSpeed: Optional[float] = None
    windDirection: Optional[float] = None
    waveHeight: Optional[float] = None
    temperature: Optional[float] = None
    source: str = "unknown"
    dataStatus: DataStatus = "MODELLED"


class Incident(BaseModel):
    """Matches the web client's Incident type, plus audit fields (incidentCode,
    createdAt/updatedAt/confirmedAt, modelVersion) it can ignore."""
    id: str
    incidentCode: Optional[str] = None
    name: str
    lat: float
    lon: float
    region: str = ""
    oilType: str = ""
    persistence: Literal["Persistent", "Non-persistent"] = "Persistent"
    volumeTonnes: float = 0
    spillAreaKm2: float = 0
    cause: str = ""
    status: IncidentStatus = "CONFIRMED"
    risk: RiskLevel = "MEDIUM"
    detectedAt: str = ""
    confirmedAt: Optional[str] = None
    mlConfidence: float = 0
    detectionSource: str = ""
    notes: Optional[str] = None
    imageDataUrl: Optional[str] = None
    telemetry: Telemetry = Field(default_factory=Telemetry)
    createdAt: Optional[str] = None
    updatedAt: Optional[str] = None


class IncidentCreate(BaseModel):
    name: str
    lat: float
    lon: float
    oilType: str = "Crude Oil"
    persistence: Literal["Persistent", "Non-persistent"] = "Persistent"
    volumeTonnes: float = 0
    spillAreaKm2: float = 0
    cause: str = "Unknown"
    mlConfidence: float = 0
    detectionSource: str = "Uploaded Satellite Image"
    region: Optional[str] = None
    notes: Optional[str] = None
    imageDataUrl: Optional[str] = None
    detectedAt: Optional[str] = None
    createdBy: Optional[str] = None
    # If true, the server fetches live environmental telemetry (Open-Meteo) and
    # stores it as the incident's first EnvironmentalSnapshot.
    loadEnvironment: bool = True


class EnvironmentField(BaseModel):
    value: Optional[float]
    unit: str


class EnvironmentResponse(BaseModel):
    incidentId: Optional[str] = None
    timestamp: str
    observationTime: Optional[str] = None
    wind: dict
    current: dict
    wave: EnvironmentField
    temperature: EnvironmentField
    source: str
    dataStatus: DataStatus
    confidence: float


# --------------------------------------------------------------------------
# Simulation
# --------------------------------------------------------------------------
class WindInput(BaseModel):
    speed: float
    direction: float


class CurrentInput(BaseModel):
    speed: float
    direction: float


class SimulationCreate(BaseModel):
    incidentId: str
    startTime: Optional[str] = None
    durationHours: float = 72
    timeStepMinutes: float = 15
    wind: Optional[WindInput] = None
    current: Optional[CurrentInput] = None
    windage: float = 0.03
    diffusion: bool = True
    uncertainty: bool = True
    simulationType: Literal["drift", "scenario"] = "drift"
    # Overrides for scenario runs (What-If); applied on top of the incident.
    volumeScale: float = 1.0


class SimulationCreated(BaseModel):
    simulationId: str
    status: str
    modelVersion: str


class TrajectoryPoint(BaseModel):
    timestamp: str
    hours: float
    latitude: float
    longitude: float
    velocity: float
    direction: float
    distanceKm: float
    uncertaintyRadiusKm: float
    intensity: float
    status: str


class UncertaintyBand(BaseModel):
    enabled: bool
    confidence: float
    radiusKm: list[float]
    # Corridor polygon (lat/lon ring) enclosing the modelled spread envelope.
    polygon: list[list[float]]
    label: str = "Modelled uncertainty"


class Waypoint(BaseModel):
    """Coarse, labelled reporting-hour marker (0/6/12/24/48/72h) for the map and
    the forecast table — distinct from the dense per-timestep trajectory."""
    hours: float
    latitude: float
    longitude: float
    distanceKm: float
    uncertaintyKm: float
    beached: bool


class Simulation(BaseModel):
    id: str
    incidentId: str
    simulationType: str
    status: str
    modelVersion: str
    startTime: Optional[str]
    durationHours: float
    timeStepMinutes: float
    parameters: dict
    resultSummary: dict
    createdAt: str
    completedAt: Optional[str]


class TrajectoryResponse(BaseModel):
    simulationId: str
    modelVersion: str
    engine: str
    # Dense per-timestep path (the polyline the map draws).
    points: list[TrajectoryPoint]
    # Coarse labelled markers (map pins + forecast table).
    waypoints: list[Waypoint]
    uncertainty: UncertaintyBand
    speed: float
    directionDeg: float
    uOil: float
    vOil: float
    windageCoefficient: float
    beached: bool
    beachedAtHours: Optional[float]
    diffusionKm2PerS: float
    notes: list[str]


# --------------------------------------------------------------------------
# Impact
# --------------------------------------------------------------------------
class ImpactFactor(BaseModel):
    name: str
    contribution: float
    value: Optional[float] = None
    reason: str


class ImpactResult(BaseModel):
    incidentId: str
    score: float
    severity: RiskLevel
    confidence: float
    factors: list[ImpactFactor]
    reasons: list[str]
    exposures: list[dict]
    inputs: dict
    modelVersion: str
    modelBacking: dict  # real model MAE/R²/rows when the ML regressor was used
    dataStatus: DataStatus = "ESTIMATED"
    createdAt: str


# --------------------------------------------------------------------------
# Historical intelligence
# --------------------------------------------------------------------------
class SimilarCase(BaseModel):
    incidentId: str
    name: str
    location: str
    region: str
    date: str
    oilType: str
    volumeTonnes: float
    similarity: float
    reasons: list[str]


# --------------------------------------------------------------------------
# Response
# --------------------------------------------------------------------------
class ResponseActionModel(BaseModel):
    rank: int
    action: str
    title: str
    priority: RiskLevel
    reason: str
    timeSensitivity: str
    timing: str
    resources: list[str]
    chain: list[str]


class ResourceRecommendation(BaseModel):
    resource: str
    type: str
    recommended: str
    available: str
    availability: str


class ManpowerEstimate(BaseModel):
    roles: list[dict]
    total: int


class ResponsePlanModel(BaseModel):
    incidentId: str
    priority: RiskLevel
    situation: list[dict]
    actions: list[ResponseActionModel]
    resources: list[ResourceRecommendation]
    manpower: ManpowerEstimate
    reasoning: list[dict]
    summary: str
    modelVersion: str
    generatedAt: str


class ChatRequest(BaseModel):
    incidentId: str
    question: str


class ChatResponse(BaseModel):
    text: str
    metrics: list[dict] = Field(default_factory=list)
    table: list[dict] = Field(default_factory=list)
    chain: list[str] = Field(default_factory=list)
    grounding: dict = Field(default_factory=dict)
