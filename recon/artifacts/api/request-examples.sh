#!/usr/bin/env bash
# MIC 上游接口 - 可复现请求样例（2026-11-15 实测可用）
# 说明：全部为匿名 HTTP 请求，不需要浏览器 / 不需要 cookie。
# 唯一需要的特殊头：X-Requested-With: XMLHttpRequest（m.made-in-china.com 的 JSON 网关靠它路由）。
set -euo pipefail
UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36'
UAM='Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'

echo '### 1) 供应商搜索 JSON（匿名、纯 HTTP）'
# body 参数：word 必填；page 从 1 开始；pageSize 默认 20（服务端实际每页仍 20）；
# 过滤器：province / catCode / comBusinessType / managementCertification / memberLevel / annualRevenue / rdCapacity
curl -sS --compressed -A "$UA" \
  -H 'X-Requested-With: XMLHttpRequest' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data 'word=glass&page=1&province=Hebei' \
  'https://m.made-in-china.com/search/supplier'

echo '### 2) 供应商搜索过滤器字典（facet + counts）'
curl -sS --compressed -A "$UA" \
  -H 'X-Requested-With: XMLHttpRequest' \
  'https://m.made-in-china.com/search/supplier/refine?word=glass&page=1&province=Hebei'

echo '### 3) 产品搜索 JSON（匿名；GET HTML 会出 Focus Captcha，POST JSON 不会）'
curl -sS --compressed -A "$UA" \
  -H 'X-Requested-With: XMLHttpRequest' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data 'word=glass&page=1&catCode=1502080000' \
  'https://m.made-in-china.com/search/product'

echo '### 4) 产品过滤器字典'
curl -sS --compressed -A "$UA" \
  -H 'X-Requested-With: XMLHttpRequest' \
  'https://m.made-in-china.com/search/product/refine?word=glass&page=1'

echo '### 5) 公司详情（移动站 SSR，内含 <script type="text/json" id="ssrData"> 结构化 JSON）'
curl -sS --compressed -L -A "$UAM" \
  'https://m.made-in-china.com/company-xingchenglass/info.html'
# 提取：python3 -c "import re,sys,json;h=open('out.html').read();m=re.search(r'<script type=\"text/json\" id=\"ssrData\">(.*?)</script>',h,re.S);print(json.loads(m.group(1)))"

echo '### 5b) 数字 comId -> mainUserAccount（301）'
curl -sSI -A "$UAM" 'https://m.made-in-china.com/company/1800987236' | grep -i '^location'

echo '### 6) SGS 审核报告章节可用性（comId 必须用 encodeComId，不能用数字 id）'
curl -sS --compressed -A "$UA" \
  'https://www.made-in-china.com/multi-search/sgs/report?comId=bSrtEKgyYcUf&lanCode=0'

echo '### 7) 平均响应时间/响应率（date 用 YYYYMMDD，页面 JS 用 today-2d）'
curl -sS --compressed -A "$UA" \
  'https://data.made-in-china.com/extend/busiMerge/replyRate?date=20261113&comId=bSrtEKgyYcUf&operatorNo=all'

echo '### 8) 联系人（TradeMessenger 子账号名）'
curl -sS --compressed -A "$UA" \
  'https://www.made-in-china.com/im.do?xcase=getSubAccount&comIdStr=bSrtEKgyYcUf,qbhmyDJoHfHi'

echo '### 9) TradeMessenger 在线状态'
curl -sS --compressed -A "$UA" \
  'https://www.made-in-china.com/ajaxfunction.do?xcase=getTmStatus&user_ids[]=bSrtEKgyYcUf_00&user_ids[]=qbhmyDJoHfHi_00'

echo '### 10) 公司评分/评价'
curl -sS --compressed -A "$UA" \
  -H 'X-Requested-With: XMLHttpRequest' \
  'https://m.made-in-china.com/user/review/front/next?pageNum=1&sortType=1&foldFlag=false&reviewType=0&receiverComId=UCJfyzwThnqK'

echo '### 11) 搜索联想（供应商/产品），英文；返回 null({...}) JSONP 文本'
curl -sS --compressed -A "$UA" \
  'https://keywordsuggestions.made-in-china.com/suggest/getEnSupplierSuggest.do?param=glass&kind=5&ad=1&id=MICSearchSuggest&count=10&ignoreCase=true&matchAnywhere=true&catflag=1'
curl -sS --compressed -A "$UA" \
  'https://keywordsuggestions.made-in-china.com/suggest/getEnProdSuggest.do?param=glass&kind=5&ad=1&id=MICSearchSuggest&count=10&ignoreCase=true&matchAnywhere=true&catflag=1&seo=1'

echo '### 12) SEO 城市筛选（城市/员工数唯一入口；匿名时好时坏，需要重试/暖会话）'
curl -sS --compressed -A "$UA" \
  'https://www.made-in-china.com/company-search/glass/C1--CP_Hebei--CC_Hebei_Langfang/1.html'

echo '### 13) 头部/杂项'
curl -sS --compressed -A "$UA" -H 'X-Requested-With: XMLHttpRequest' 'https://www.made-in-china.com/head.do?xcase=getHead'
curl -sS --compressed -A "$UA" 'https://www.made-in-china.com/head.do?xcase=entrances&_t=0&lanCode=0'
curl -sS --compressed -A "$UA" -H 'X-Requested-With: XMLHttpRequest' 'https://www.made-in-china.com/ajaxfunction.do?xcase=getKeywordHistory'
