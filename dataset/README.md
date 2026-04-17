# AD-DRAC Model Market Experiment

## 目标

构造一个由 **~150 个真实可评估的自动驾驶模型配置**组成的模型市场，每个模型在 nuScenes 数据集上具有真实（非合成）的性能数据，替换原论文中基于高斯分布采样的500个合成模型。

---

## 目录结构

```
model_market_experiment/
├── configs/
│   ├── idm/          # IDM 超参数扫描配置 (YAML), 约50个
│   ├── uniad/        # UniAD 推理超参配置 (YAML), 约30个
│   └── vad/          # VAD 推理超参配置 (YAML), 约30个
├── runners/
│   ├── run_idm.py    # IDM 评估脚本
│   ├── run_uniad.py  # UniAD 评估脚本（需GPU）
│   └── run_vad.py    # VAD 评估脚本（需GPU）
├── results/
│   ├── idm_runs/     # 每个IDM config的原始输出 (JSON)
│   ├── uniad_runs/   # 每个UniAD config的原始输出 (JSON)
│   └── vad_runs/     # 每个VAD config的原始输出 (JSON)
├── analysis/
│   ├── map_to_five_dims.py  # 原始指标 → 五维分数映射
│   └── generate_report.py  # 生成 report.md + 散点图
├── final_table.csv   # 最终交付物：所有配置的五维评分
├── requirements.txt  # Python 依赖
└── README.md         # 本文件
```

---

## 三个模型的选择理由

| 模型 | 类型 | 选择理由 |
|------|------|---------|
| **IDM** (Intelligent Driver Model) | 规则驱动 | 纯Python实现，无需GPU，超参敏感性强（headway/acc/decel三轴扫描可直接反映安全-效率权衡），可在nuScenes mini上快速验证完整pipeline |
| **UniAD** | 端到端学习 | 官方代码开源，nuScenes val上有权威基准数据；planning_head的safety_margin可直接影响碰撞/干预指标；与IDM形成规则 vs 学习的对比 |
| **VAD** (Vectorized AD) | 端到端学习 | 轻量化端到端模型，与UniAD形成大模型 vs 轻量模型的对比；超参（速度阈值、规划horizon等）对五维分数的影响模式与UniAD互补 |

---

## 五维评估维度定义

论文中定义的五个核心维度（Section III-B）：

| 维度 | 列名 | 含义 |
|------|------|------|
| 安全性 | `safety_score` | 碰撞风险、紧急干预频率 |
| 效率性 | `efficiency_score` | 行驶速度、轨迹跟踪精度 |
| 舒适性 | `comfort_score` | 加速度平滑性 |
| 合规性 | `compliance_score` | 交通规则遵守情况 |
| 领域兼容性/交互 | `interaction_score` | 模型训练域与目标场景的语义对齐度（ODD余弦相似度） |

> **⚠️ 注意**：任务描述中将第五维称为 `interaction_score`，但论文正文（Section III-B）定义的第五维为 **Domain Compatibility**（$I_{comp}$，基于ODD向量余弦相似度）。本实验按论文正文实现，列名暂用 `interaction_score`。**请确认是否需要改为 `interaction_score`，以及两者是否指同一概念。**

---

## 原始指标到五维的映射公式

### 原始指标（每个评估run输出）

| 原始指标 | 来源 | 用于哪个维度 |
|---------|------|------------|
| `ttc_mean` | 场景平均 TTC (s) | safety |
| `collision_ratio` | 碰撞次数/总场景数 | safety |
| `num_interventions` | 人工干预次数 | safety |
| `avg_velocity` | 平均速度 (m/s) | efficiency |
| `max_lane_offset` | 最大车道偏移 (m) | efficiency |
| `num_traffic_violations` | 交通违规次数 | compliance |
| `jerk_mean` | 平均 jerk (m/s³) | comfort |
| `max_acceleration` | 最大加速度 (m/s²) | comfort |
| `odd_vector` | [road, weather, traffic, light] | domain_compatibility |

### 映射公式（初版，线性归一化到 [0, 1]）

所有映射均为：越高越好 → 直接归一化；越低越好 → 取反后归一化。

**safety_score**（越高=越安全）：

```
ttc_norm     = clip((TTC_mean - TTC_min) / (TTC_max - TTC_min), 0, 1)
cr_norm      = 1 - clip(collision_ratio / CR_max, 0, 1)
interv_norm  = 1 - clip(num_interventions / INTERV_max, 0, 1)

safety_score = (0.4 * ttc_norm + 0.4 * cr_norm + 0.2 * interv_norm) * 100
```

**efficiency_score**（越高=越高效）：

```
vel_norm    = clip((avg_velocity - VEL_min) / (VEL_max - VEL_min), 0, 1)
offset_norm = 1 - clip(max_lane_offset / OFFSET_max, 0, 1)

efficiency_score = (0.5 * vel_norm + 0.5 * offset_norm) * 100
```

**comfort_score**（越高=越舒适）：

```
jerk_norm = 1 - clip(jerk_mean / JERK_max, 0, 1)
acc_norm  = 1 - clip(max_acceleration / ACC_max, 0, 1)

comfort_score = (0.5 * jerk_norm + 0.5 * acc_norm) * 100
```

**compliance_score**（越高=越合规）：

```
compliance_score = (1 - clip(num_traffic_violations / VIOL_max, 0, 1)) * 100
```

**interaction_score**（基于ODD余弦相似度）：

```
# V_T = 目标场景ODD向量, V_M = 模型验证域ODD向量
interaction_score = cosine_similarity(V_T, V_M) * 100
```

> 归一化参数（`TTC_max`, `CR_max` 等）将从三个 benchmark 模型的实测区间自动计算，而非手动设定。

---

## 最终 CSV 格式

```
config_id, model_family, [超参数列], safety_score, efficiency_score, comfort_score, compliance_score, interaction_score, [原始指标列]
```

| 模型 | 超参数列 | 配置数 |
|------|---------|-------|
| IDM | `desired_time_headway`, `max_acceleration`, `comfort_deceleration` | ~50 |
| UniAD | `safety_margin`, `max_speed_threshold`, `checkpoint_stage` | ~30 |
| VAD | `planning_horizon`, `max_speed_threshold`, `ego_agent_radius` | ~30 |

---

## 实验约束

- nuScenes mini split（~4GB）用于 pipeline 验证；val split 用于正式实验
- 随机种子固定为 42（所有脚本）
- 不自动下载 >10GB 数据；GPU 相关步骤（UniAD/VAD）前确认硬件可用
- 每个 config 跑完打印一行进度日志

---

## Milestone 进度

- [x] Milestone 1: 环境搭建 + 项目骨架
- [ ] Milestone 2: IDM 扫描（~50个配置）
- [ ] Milestone 3: UniAD 扫描（~30个配置，需GPU）
- [ ] Milestone 4: VAD 扫描（~30个配置，需GPU）
- [ ] Milestone 5: 五维映射 + 最终表
