"""Agentic narrator: a tool-calling loop over the pipeline's own outputs.

Deliberately thin -- this exists for the presentation, not as new ML surface
area. The model is given exactly three tools and is instructed to answer only
by calling them; it never invents a score or a coordinate. Default backend is
a local Ollama model so the live demo doesn't depend on venue internet; swap
`OLLAMA_MODEL` for a hosted API later if you want more polished prose and
don't mind the network dependency.
"""
import json
from dataclasses import dataclass
from typing import Callable

OLLAMA_MODEL = "llama3.2:3b"  # or "phi3:mini" -- both run fine on 8GB VRAM alongside a stopped training job


@dataclass
class PipelineContext:
    """Populated once per incident from the actual pipeline outputs -- the
    tools below only ever read from this, never compute anything new.
    """
    score_breakdowns: dict  # mmsi -> ScoreBreakdown.as_dict()
    slick_geometry: dict    # area_m2, elongation, age_estimate_hours, uncertainty_hours
    cone_stats: dict        # centroid, radius_km, time_window


def make_tools(ctx: PipelineContext) -> dict[str, Callable]:
    return {
        "get_score_breakdown": lambda mmsi: ctx.score_breakdowns.get(mmsi, {"error": "unknown mmsi"}),
        "get_slick_geometry": lambda: ctx.slick_geometry,
        "get_drift_cone_stats": lambda: ctx.cone_stats,
    }


SYSTEM_PROMPT = """You are Varuna's incident narrator. You explain an oil-spill
attribution result to a human reviewer. You MUST answer only using the tool
outputs provided to you -- never estimate, guess, or invent a number,
coordinate, or vessel name that didn't come from a tool call. If a tool
doesn't have the answer, say so plainly instead of filling the gap."""


def generate_incident_report(ctx: PipelineContext, top_n_mmsi: list[str]) -> str:
    """TODO: wire up `ollama.chat` (the `ollama` pip package, talking to a
    locally running `ollama serve`) with function-calling over make_tools(ctx),
    seeded with SYSTEM_PROMPT and a user turn asking for a report covering
    top_n_mmsi. See https://github.com/ollama/ollama-python for the tool-call
    request/response shape -- it mirrors the OpenAI function-calling format.
    """
    raise NotImplementedError("wire up the ollama tool-calling loop here")


def answer_question(ctx: PipelineContext, question: str) -> str:
    """Same tool-calling loop as generate_incident_report, but for a live
    follow-up question from a judge during the demo instead of the initial
    report.
    """
    raise NotImplementedError("wire up the ollama tool-calling loop here")
