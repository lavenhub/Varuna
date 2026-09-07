"""OILY operational services layer.

A thin, production-shaped application layer that sits alongside the Varuna
scientific/ML code and is exposed to the OILY web client through the same
FastAPI process (see ``varuna.app.inference_api``). It is deliberately kept
separate from the ML/physics modules:

    varuna.detect / varuna.hindcast / ...   -> science + ML (the "engine")
    varuna.oily                              -> incidents, simulations,
                                                environment, impact composition,
                                                historical intelligence,
                                                response planning, chat

The separation mirrors the layering NOAA's GNOME/PyGNOME stack uses (Model ->
Environment -> Movers -> Weatherers -> Outputters) without cloning it: OILY's
own conceptual split is Incident -> Environment -> Movement -> Fate -> Impact
-> Response -> Output. Every result the web client shows is produced here and
returned as structured JSON; the client is a visualization layer, not a source
of scientific truth.
"""

OILY_DB_VERSION = 1
