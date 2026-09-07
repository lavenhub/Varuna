"""Train a real regression model on the NOAA oil-spill environmental master
dataset to predict environmental_impact_score, replacing the Oily frontend's
hand-written JS heuristic (lib/oily/engine.ts calculateImpact) with a model
fit on 2,076 real historical incidents and their documented severity scores.

Dataset provenance: NOAA Office of Response and Restoration incident records,
1957-2026, scored via a published formula (100 * sqrt(hazard * exposure))
built from cited literature -- see "enviromental impact/oil_spill_dataset_
description.pdf". We do NOT reuse hazard_component/exposure_component as
model inputs (that would just be re-deriving the known closed-form formula);
instead we train on the raw incident features a NEW spill actually has at
detection time, so the model must learn the hazard/exposure relationship
itself and can generalize to incidents the formula's exact inputs don't
cover.

    .venv311\\Scripts\\python.exe scripts\\train_impact_model.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

import numpy as np
import pandas as pd
from joblib import dump
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.metrics import mean_absolute_error, r2_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder

CSV_PATH = Path(r"C:\Users\lavis\Desktop\sih'26\enviromental impact\oil_spill_environmental_master_v2 (1).csv")
OUT_PATH = Path(__file__).resolve().parent.parent / "models" / "impact_model.joblib"

NUMERIC_FEATURES = ["max_ptl_release_tonnes_log", "distance_to_coast_km_log", "abs_latitude"]
CATEGORICAL_FEATURES = ["oil_persistence_class", "is_ocean_point", "coral_climate_range", "mangrove_climate_range"]
TARGET = "environmental_impact_score"


def load_training_frame() -> pd.DataFrame:
    df = pd.read_csv(CSV_PATH, encoding="utf-8-sig")
    df = df[df["impact_score_status"] == "scored"].copy()

    # Only keep rows where every feature we intend to train on is present --
    # no imputation/guessing, matching the dataset's own "leave gaps as gaps"
    # philosophy from the description PDF.
    required = ["max_ptl_release_tonnes", "distance_to_coast_km", "oil_persistence_class",
                "is_ocean_point", "coral_climate_range", "mangrove_climate_range",
                "latitude", TARGET]
    df = df.dropna(subset=required)

    df["max_ptl_release_tonnes_log"] = np.log1p(df["max_ptl_release_tonnes"].astype(float))
    df["distance_to_coast_km_log"] = np.log1p(df["distance_to_coast_km"].astype(float))
    df["abs_latitude"] = df["latitude"].astype(float).abs()
    df["is_ocean_point"] = df["is_ocean_point"].astype(int).astype(str)
    df["coral_climate_range"] = df["coral_climate_range"].astype(int).astype(str)
    df["mangrove_climate_range"] = df["mangrove_climate_range"].astype(int).astype(str)
    return df


def main():
    df = load_training_frame()
    print(f"Training rows (scored + complete features): {len(df)}")

    X = df[NUMERIC_FEATURES + CATEGORICAL_FEATURES]
    y = df[TARGET].astype(float)

    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

    preprocess = ColumnTransformer([
        ("num", "passthrough", NUMERIC_FEATURES),
        ("cat", OneHotEncoder(handle_unknown="ignore"), CATEGORICAL_FEATURES),
    ])
    model = Pipeline([
        ("preprocess", preprocess),
        ("regressor", HistGradientBoostingRegressor(max_depth=4, max_iter=200, random_state=42)),
    ])

    model.fit(X_train, y_train)
    pred = model.predict(X_test)

    mae = mean_absolute_error(y_test, pred)
    r2 = r2_score(y_test, pred)
    baseline_pred = np.full_like(y_test, y_train.mean())
    baseline_mae = mean_absolute_error(y_test, baseline_pred)

    print(f"\nHeld-out test set (n={len(y_test)}):")
    print(f"  MAE  = {mae:.2f}  (points on the 0-100 scale)")
    print(f"  R^2  = {r2:.3f}")
    print(f"  vs. always-predict-the-mean baseline MAE = {baseline_mae:.2f}")

    # Refit on all data for the deployed model, keeping the held-out metrics above as the honest report.
    model.fit(X, y)
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    dump({"model": model, "test_mae": mae, "test_r2": r2, "n_train": len(df)}, OUT_PATH)
    print(f"\nSaved trained model to {OUT_PATH}")


if __name__ == "__main__":
    main()
