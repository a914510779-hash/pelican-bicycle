# 鹈鹕海岸单车 (Pelican Bicycle Kinematics)

向经典的「鹈鹕骑自行车（Pelican riding a bicycle）」创意工程挑战致敬的交互式 Web 项目。相比静态 SVG，本项目用**纯数学运动学 + 物理弹簧系统 + 程序化 Web Audio** 构建了一只真正在海滨栈道骑行、吞鱼、翘头的鹈鹕。

## 核心技术亮点

- **精确 2-Bone 逆向运动学（IK）**：[`solveTwoBoneIK`](./src/kinematics.js) 通过余弦定理解析求解髋关节 → 膝关节 → 脚踏以及肩关节 → 肘关节 → 车把的实时骨骼姿态，保证 360° 踩踏全程双脚严丝合缝锁定踏板、无脱节穿模。
- **零打滑传动与精确链条切线**：[`computeChainTangents`](./src/kinematics.js) 解析计算前后齿轮的外公切线并驱动链节动画；车轮角速度严格满足 $\omega = v / R$，栈道木板位移与轮缘线速度 1:1 匹配。
- **弹性物理与 Verlet 丝巾**：[`SpringDamper`](./src/kinematics.js) 驱动车座避震、抬头仰角、鸟喙开合与半透明喉囊晃动（吞下跃起的鱼后，鱼影会在喉囊中晃动再抛入车筐）；[`VerletRibbon`](./src/kinematics.js) 模拟迎风飘动的条纹围巾。
- **工程透视（X-Ray IK Blueprint）**：按 `K` 或点击「工程透视 IK」可实时叠加骨骼向量、膝关节角度 $\beta$、链条切线、踏频 RPM 与喉囊阻尼位移。
- **零外部资源的程序化音效**：[`PelicanAudio`](./src/audio.js) 使用 Web Audio API 实时合成海浪滤波白噪、铜车铃泛音、溜车棘轮声、跳跃与吞鱼马林巴音阶。

## 交互控制

- **点击画布 / `Space` / `↑`**：腾空跳跃 + 张大鸟喙吞捕跃出水面的海鱼（含稀有金鱼）并可飞跃螃蟹
- **按住 `W` / 点击「翘头」**：以后轮轴心为支点拉起帅气翘头（Wheelie）
- **`B` / 点击「叮铃」**：敲响车把铜铃，惊起天上的海鸥
- **`K` / 点击「工程透视 IK」**：切换实时逆向运动学工程视图
- **`T` / 切换天色**：在「晴空海岸 / 落日栈道 / 月夜灯塔」间切换（夜间自动点亮复古车灯与海岸灯塔光束）
- **`←` / `→` 或 `A` / `D`**：实时减速 / 冲刺加速

## 目录结构

```text
pelican-bicycle/
├── index.html              # 独立网页入口
├── src/
│   ├── kinematics.js       # 2-Bone IK、链条外公切线、弹簧阻尼、Verlet 丝巾
│   ├── renderer.js         # High-DPI Canvas 2D 视差海岸场景与机械/鹈鹕渲染器
│   ├── audio.js            # 程序化 Web Audio 海岸音效合成器
│   ├── game.js             # 物理循环、跃鱼/螃蟹生成与交互控制
│   ├── main.js             # 页面控件绑定
│   └── styles.css          # 海岸主题样式
└── tests/
    └── kinematics.test.mjs # Node 内置测试套件（验证 IK 与几何不变量）
```

## 运行单元测试

```bash
node --test tests/kinematics.test.mjs
```
