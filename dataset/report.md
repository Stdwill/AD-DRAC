# AD-DRAC Model Market Experiment — Report

**Total configs:** 144  
**Generated:** from nuScenes mini (10 scenes) + published benchmarks

## Config Count per Family

| Model Family | Count | Data Type |
|--------------|-------|-----------|
| IDM | 50 | simulated_closed_loop |
| PDM | 40 | simulated_closed_loop |
| SFM | 30 | simulated_closed_loop |
| UniAD | 12 | published_open_loop |
| VAD | 12 | published_open_loop |

## Five-Dim Score Statistics (mean ± std, min, max)

| Family | Safety | Efficiency | Comfort | Compliance | Interaction |
|--------|--------|------------|---------|------------|-------------|
| IDM | 93.4±4.9 | 47.0±0.9 | 63.6±19.8 | 100.0±0.0 | 74.8±0.0 |
| PDM | 68.8±9.0 | 46.0±9.6 | 27.3±11.4 | 58.8±37.4 | 86.5±0.0 |
| SFM | 56.4±7.4 | 44.2±1.2 | 54.7±3.5 | 100.0±0.0 | 92.9±0.0 |
| UniAD | 60.6±0.6 | 72.4±0.1 | 95.4±0.8 | 90.0±0.0 | 98.6±0.0 |
| VAD | 60.7±0.3 | 75.3±0.1 | 99.6±0.3 | 92.5±0.0 | 99.8±0.0 |

## Raw Metric Ranges

| Metric | Global Min | Global Max | Unit | Direction |
|--------|-----------|-----------|------|-----------|
| avg_velocity | 6.53 | 12.38 | m/s | higher=better |
| collision_ratio | 0.0000 | 0.4000 | fraction | lower=better |
| mean_l2_error | 0.357 | 70.484 | m | lower=better |
| jerk_mean | 0.0975 | 1.4746 | m/s³ | lower=better |
| ttc_mean | 12.40 | 94.45 | s | higher=better |
| num_interventions | 0.00 | 15.60 | per scene | lower=better |
| num_traffic_violations | 0.0000 | 0.2000 | per scene | lower=better |

## Important Notes

1. **mean_l2_error** for IDM/PDM/SFM is **closed-loop** displacement error vs nuScenes GT (scene-level, metres). For UniAD/VAD it is the **open-loop** planning L2 at 3 s horizon (from published papers). Both are in metres but measure different quantities. The `data_type` column distinguishes them.

2. **compliance_score** for simulated models is based on speed-limit violations only (proxy). UniAD/VAD values are estimated from their published driving scores.

3. **interaction_score** = cosine similarity of the model's ODD vector to the nuScenes target ODD [0.75, 0.15, 0.60, 0.15]. All nuScenes-trained models share similar ODD vectors, so variance is low (~0.99). For a realistic market, ODD vectors should span diverse domains (highway, night, rain).

## Figures

- `figs/five_dim_overview.png` — radar chart + box plots + score-bid scatter
- `figs/score_scatter.png`     — safety vs efficiency, comfort vs compliance