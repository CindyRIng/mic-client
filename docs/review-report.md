# M0 文档评审报告（文档基线）

> 版本：1.0 ｜ 状态：**Approved**（M0 文档基线通过）｜ 评审人：lead ｜ 日期：2026-11-15
> 范围：`docs/01–08`、`docs/glossary.md`、`docs/decisions/`（ADR-0001…0007）、`docs/research/`（调研与证据）
> 依据：[docs/README.md](README.md) §4 评审检查清单；Writers 交付时上报的跨文档差异（V-14/V-15、OQ-03-13/14、OQ-04-11/15）

---

## 1. 评审方法与工具

| 检查项 | 方法 |
|---|---|
| 文档头/状态 | 检查每篇是否含「版本/状态/负责人/最后更新/关联」 |
| 事实一致性 | 抽查上游端点/参数/限制/会员/匿名边界条目，与 `docs/research/` 及 `recon/artifacts/api/` 对照 |
| 编号可追溯 | grep FR-01…FR-15 / NFR-01…06 / AC / TC / OQ 的引用闭合性 |
| 契约一致性 | 扫描错误码、warning 码、`tier`/`source`/`availability_reason` 枚举、分页/缓存/广告/中文关键词规则 |
| 接口示例 | 解析 03/04 中所有 ```json 代码块为合法 JSON；检查 curl 示例与参数表一致 |
| 链接与图表 | 相对链接可达性检查；Mermaid 数量；无悬空引用 |
| 安全/合规 | 仅回环监听、无鉴权边界说明、限速、非公开字段不建模为「登录可得」 |
| 残余问题 | 汇总 writers 上报差异 + 本次发现，逐条裁定并回写 |

## 2. 文档规模（评审时快照）

| 文档 | 行数 | Mermaid | JSON 示例 |
|---|---|---|---|
| 01-requirements.md | 1182 | 2 | — |
| 02-architecture.md | 1559 | 11 | — |
| 03-rest-api.md | 3279 | 2 | 37（全部可解析 ✅） |
| 04-cli-mcp.md | 2920 | 3 | 32（全部可解析 ✅） |
| 05-data-and-cache.md | 1642 | 3 | — |
| 06-test-acceptance.md | 575 | 1 | — |
| 07-operations.md | 194 | 0 | — |
| 08-roadmap.md | 121 | 1 | — |
| docs/README.md + glossary.md | 245 | 0 | — |
| decisions/（7 ADR + 索引） | ~450 | 0 | — |
| research/（5 文档 + 证据） | 既有 | — | — |

## 3. 检查结果

| 检查项 | 结果 | 说明 |
|---|---|---|
| 文档头齐全 | ✅ | 01–08 全部含版本/状态/负责人/日期/关联 |
| FR/NFR 可追溯 | ✅ | 01 定义；02/03/04/05/06 引用；06 有 AC↔TC 100% 覆盖矩阵 |
| 错误码一致 | ✅ | 11 个 canonical 错误码 + `details.reason` 登记表；各文档只引用 |
| warning 码一致 | ✅（已修复） | canonical 22 码；01/05/06 旧名已替换（见 §4） |
| 分页契约一致 | ✅（已修复） | page 1–100、page_size 1–100、上游 20/页拼接、2000 封顶、page 夹取 |
| 中文关键词 | ✅（已修复） | 统一为「可映射地区名→地区模式；否则 400 INVALID_PARAM / NON_ENGLISH_KEYWORD」 |
| 广告策略 | ✅（已修复） | REST/MCP 默认 `include_ads=true` 保留并标 `is_ad`；CLI 表格默认隐藏；`--exclude-ads`→`ADS_FILTERED` |
| TTL 口径 | ✅（已修复） | 03 §1.8 = 05 §7.3：audit 7d / response 6h / contacts 24h / reviews 12h；02/07 配置键已补齐 |
| 库名/schema | ✅（已修复） | `~/.mic-client/data/mic.sqlite`；`schema_version=1` ↔ `PRAGMA user_version=1` |
| 链接可达 | ✅ | 相对链接 0 悬空（评审修复后复检） |
| JSON 示例合法 | ✅ | 03 37/37、04 32/32 可解析 |
| 图表 | ✅ | Mermaid 合计 23 张（架构 11、接口/流程/测试等 12） |
| 安全/合规 | ✅ | 本地回环、无鉴权说明、限速 1.5–2.5s、非公开字段 `not_public_by_platform` |
| 开放问题登记 | ✅ | OQ-01…OQ-12（01）、OQ-03-01…14、OQ-04-01…15；V-01…V-13 待 M1+ 实测 |

## 4. 跨文档冲突裁决与修复（本轮）

| ID | 冲突 | 裁决（canonical） | 修复位置 |
|---|---|---|---|
| V-14 | 03 §1.8 与 05 §7.3 增强 TTL 不一致 | 统一为 **audit 7d / response 6h / contacts 24h / reviews 12h**；`search_index` 6h、`empty_list` 1h | 02 配置键、07 配置表、05/03 表 |
| V-15a | 中文关键词：03=400 拒绝 vs 04=warning 后照常请求 | **以 03 为契约源**：可映射地区名→地区模式；否则 `400 INVALID_PARAM` + `details.reason=NON_ENGLISH_KEYWORD`，不静默空结果 | 01（R3/AC）、04 R3、06 用例 |
| V-15b | 广告默认：03/05 保留 vs 04 默认剔除 | **REST/MCP 默认 `include_ads=true` 保留并标 `is_ad=true`（与上游分页 1:1）；CLI 表格默认隐藏（`--include-ads` 显示）；`--exclude-ads`/`include_ads=false` 过滤并给 `ADS_FILTERED`** | 02 §4、04 §2.7.1、05 §4.1、03 §7.9 |
| V-15c | city 过滤 warning 名：`CITY_FILTERED_LOCALLY` vs `CLIENT_SIDE_FILTER` | 两者都保留但**语义分工**：`CITY_FILTERED_LOCALLY`=按 city 过滤；`CLIENT_SIDE_FILTER`=audited 等其它本地过滤 | 01/02/03/04/05 |
| V-15d | 封顶字段名：`total_capped` vs `total_is_capped` | 统一 **`total_capped`**（`total_display`、`NON_EXHAUSTIVE` 配套） | 02、08；01/03/04/05/06 原本一致 |
| V-15e | `REGION_KEYWORD_MODE` 非 canonical warning | **移除**；地区模式通过 `query.search_mode=region` / `region_validated` / `keyword_effective` 回显，不产生 warning | 03 v0.2.1、01、02、06 |
| — | 旧 warning 同义码（`CACHE_STALE`/`STALE_CACHE`/`PARTIAL_ENRICH`/`CITY_FILTER_APPLIED`/`CITY_UNVERIFIED`/`DICTIONARY_INCOMPLETE`/`REGIONS_STALE`） | 替换为 canonical：`STALE_DATA`/`ENRICHMENT_PARTIAL`/`CITY_FILTERED_LOCALLY`/`CITY_NOT_IN_DICTIONARY`/`REGION_DICTIONARY_INCOMPLETE`；`PARAM_NORMALIZED`/`PROVINCE_INFERRED`/`CATEGORY_CODE_NOT_VERIFIED` 改为 `query` 回显或直传语义 | 01/02/05/06 |
| — | 数据库文件名：03 `mic.db`/`schema_version=3` vs 05/07 `mic.sqlite`/`user_version=1` | 统一 **`~/.mic-client/data/mic.sqlite`、`schema_version=1`** | 03 v0.2.1、04 说明、05 备注、07 目录 |
| — | 会员起始年字段：ADR `member_since_year` vs API `membership.since_year` | 明确：**对外 `membership.since_year`；数据模型内部列 `member_since_year`** | ADR-0005、05 |

## 5. 残余待验证项（不阻塞文档基线）

| ID | 事项 | 里程碑 |
|---|---|---|
| V-01 | headless 模式 Focus Captcha 自动解成功率/触发率 | M1/M3 |
| V-02 | 登录态是否改变公开字段（电话/邮箱/审核报告） | M3（需用户账号） |
| V-03 | 评论明细接口深度 | M2+（可选） |
| V-04 | 数字 comId 301 resolver 稳定性 | M2 |
| V-05 | 匿名会话 cookie 有效期 | M1–M3 |
| V-06 | `keyword + city` 组合搜索收窄效果 | M1 |
| V-07 | 城市字典全量生成/校验（OQ-03） | M1 |
| V-09 | `serve` + CLI 多进程共享 SQLite/session | M1/M3 |
| V-12 | 上游服务条款对自动化访问的具体限制（合规确认） | M0 后（用户/法务） |
| OQ-03-14 | 特殊省 `api_value`（InnerMongolia/Hongkong/Taiwan）实测 | M1 |
| OQ-01…12 / OQ-04-xx | 其余开放问题见 01 §11、03 §15.D、04 §5.6 | 按里程碑 |

## 6. 结论与签发

- **结论**：01–08 + glossary + ADR + research 构成**完整文档基线**，固定契约（FR/NFR/AC、错误码、warning、枚举、响应包、分页/缓存/广告/中文关键词/库名）已全库收敛；评审检查清单全部通过（残余项均为「待实测」，已在文档中标注「待验证」）。
- **签发**：M0 文档阶段 **Approved**（2026-11-15），可进入 M1 实现前提是用户确认。
- **M1 首步**：`W1.1 工程脚手架`（见 [08-roadmap.md](08-roadmap.md) §3），实现前不再新增契约；如实现中发现契约需改，先改文档/补 ADR（ADR-0006）。

## 7. 复现检查命令（评审用）

```bash
# 1) 断链检查
python3 - <<'PY'
import re,os,glob
bad=[]
for f in glob.glob('docs/**/*.md',recursive=True)+['README.md']:
    base=os.path.dirname(f)
    for m in re.finditer(r'\[([^\]]*)\]\(([^)]+)\)',open(f,encoding='utf-8').read()):
        t=m.group(2).strip()
        if t.startswith(('http','#','mailto:')): continue
        p=t.split('#')[0]
        if p and not os.path.exists(os.path.normpath(os.path.join(base,p))): bad.append((f,t))
print('broken:',bad)
PY

# 2) JSON 示例合法性（03/04）
python3 - <<'PY'
import re,json
for f in ['docs/03-rest-api.md','docs/04-cli-mcp.md']:
    t=open(f,encoding='utf-8').read(); n=0
    for b in re.findall(r'```json\n(.*?)```',t,re.S):
        json.loads(b); n+=1
    print(f,n,'blocks ok')
PY

# 3) 非 canonical 旧 warning 残留（应仅在变更记录/OQ 历史中出现）
grep -nE 'CACHE_STALE|STALE_CACHE|PARTIAL_ENRICH|CITY_FILTER_APPLIED|CITY_UNVERIFIED|REGION_KEYWORD_MODE|PARAM_NORMALIZED' docs/*.md | grep -v '变更记录\|OQ-\|→' || true
```
