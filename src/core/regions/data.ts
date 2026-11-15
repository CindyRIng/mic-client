/** Auto-generated from data/regions.json (docs/05 §5.2/§5.3). Do not edit manually. */
export interface CitySeed {
  name: string;
  name_zh: string;
  seo_cc: string;
  count_hint?: number;
}

export interface ProvinceSeed {
  name: string;
  name_zh: string;
  api_value: string;
  com_province: string;
  seo_cp: string;
  cities_complete: boolean;
  cities: CitySeed[];
  aliases: string[];
}

export const REGIONS_SEED: { version: number; source: string; note: string; provinces: ProvinceSeed[] } = {
  "version": 1,
  "source": "docs/05-data-and-cache.md §5.2/§5.3 + recon/artifacts/api/filters/province-list.json",
  "note": "32 provinces; only Hebei has verified city dictionary (cities_complete=true). api_value is the m-site province param.",
  "provinces": [
    {
      "name": "Guangdong",
      "name_zh": "广东",
      "api_value": "Guangdong",
      "com_province": "Guangdong",
      "seo_cp": "C1--CP_Guangdong",
      "cities_complete": false,
      "cities": [],
      "aliases": []
    },
    {
      "name": "Shandong",
      "name_zh": "山东",
      "api_value": "Shandong",
      "com_province": "Shandong",
      "seo_cp": "C1--CP_Shandong",
      "cities_complete": false,
      "cities": [],
      "aliases": []
    },
    {
      "name": "Zhejiang",
      "name_zh": "浙江",
      "api_value": "Zhejiang",
      "com_province": "Zhejiang",
      "seo_cp": "C1--CP_Zhejiang",
      "cities_complete": false,
      "cities": [],
      "aliases": []
    },
    {
      "name": "Jiangsu",
      "name_zh": "江苏",
      "api_value": "Jiangsu",
      "com_province": "Jiangsu",
      "seo_cp": "C1--CP_Jiangsu",
      "cities_complete": false,
      "cities": [],
      "aliases": []
    },
    {
      "name": "Hebei",
      "name_zh": "河北",
      "api_value": "Hebei",
      "com_province": "Hebei`（实测）",
      "seo_cp": "C1--CP_Hebei",
      "cities_complete": true,
      "cities": [
        {
          "name": "Shijiazhuang",
          "name_zh": "石家庄",
          "seo_cc": "CC_Hebei_Shijiazhuang",
          "count_hint": 215
        },
        {
          "name": "Hengshui",
          "name_zh": "衡水",
          "seo_cc": "CC_Hebei_Hengshui",
          "count_hint": 138
        },
        {
          "name": "Cangzhou",
          "name_zh": "沧州",
          "seo_cc": "CC_Hebei_Cangzhou",
          "count_hint": 98
        },
        {
          "name": "Xingtai",
          "name_zh": "邢台",
          "seo_cc": "CC_Hebei_Xingtai",
          "count_hint": 71
        },
        {
          "name": "Baoding",
          "name_zh": "保定",
          "seo_cc": "CC_Hebei_Baoding",
          "count_hint": 55
        },
        {
          "name": "Langfang",
          "name_zh": "廊坊",
          "seo_cc": "CC_Hebei_Langfang",
          "count_hint": 45
        },
        {
          "name": "Handan",
          "name_zh": "邯郸",
          "seo_cc": "CC_Hebei_Handan",
          "count_hint": 19
        },
        {
          "name": "Tangshan",
          "name_zh": "唐山",
          "seo_cc": "CC_Hebei_Tangshan",
          "count_hint": 14
        },
        {
          "name": "Qinhuangdao",
          "name_zh": "秦皇岛",
          "seo_cc": "CC_Hebei_Qinhuangdao",
          "count_hint": 13
        },
        {
          "name": "Zhangjiakou",
          "name_zh": "张家口",
          "seo_cc": "CC_Hebei_Zhangjiakou",
          "count_hint": 1
        }
      ],
      "aliases": []
    },
    {
      "name": "Fujian",
      "name_zh": "福建",
      "api_value": "Fujian",
      "com_province": "Fujian",
      "seo_cp": "C1--CP_Fujian",
      "cities_complete": false,
      "cities": [],
      "aliases": []
    },
    {
      "name": "Henan",
      "name_zh": "河南",
      "api_value": "Henan",
      "com_province": "Henan",
      "seo_cp": "C1--CP_Henan",
      "cities_complete": false,
      "cities": [],
      "aliases": []
    },
    {
      "name": "Shanghai",
      "name_zh": "上海",
      "api_value": "Shanghai",
      "com_province": "Shanghai",
      "seo_cp": "C1--CP_Shanghai",
      "cities_complete": false,
      "cities": [],
      "aliases": []
    },
    {
      "name": "Anhui",
      "name_zh": "安徽",
      "api_value": "Anhui",
      "com_province": "Anhui",
      "seo_cp": "C1--CP_Anhui",
      "cities_complete": false,
      "cities": [],
      "aliases": []
    },
    {
      "name": "Tianjin",
      "name_zh": "天津",
      "api_value": "Tianjin",
      "com_province": "Tianjin",
      "seo_cp": "C1--CP_Tianjin",
      "cities_complete": false,
      "cities": [],
      "aliases": []
    },
    {
      "name": "Hunan",
      "name_zh": "湖南",
      "api_value": "Hunan",
      "com_province": "Hunan",
      "seo_cp": "C1--CP_Hunan",
      "cities_complete": false,
      "cities": [],
      "aliases": []
    },
    {
      "name": "Jiangxi",
      "name_zh": "江西",
      "api_value": "Jiangxi",
      "com_province": "Jiangxi",
      "seo_cp": "C1--CP_Jiangxi",
      "cities_complete": false,
      "cities": [],
      "aliases": []
    },
    {
      "name": "Hubei",
      "name_zh": "湖北",
      "api_value": "Hubei",
      "com_province": "Hubei",
      "seo_cp": "C1--CP_Hubei",
      "cities_complete": false,
      "cities": [],
      "aliases": []
    },
    {
      "name": "Beijing",
      "name_zh": "北京",
      "api_value": "Beijing",
      "com_province": "Beijing",
      "seo_cp": "C1--CP_Beijing",
      "cities_complete": false,
      "cities": [],
      "aliases": []
    },
    {
      "name": "Liaoning",
      "name_zh": "辽宁",
      "api_value": "Liaoning",
      "com_province": "Liaoning",
      "seo_cp": "C1--CP_Liaoning",
      "cities_complete": false,
      "cities": [],
      "aliases": []
    },
    {
      "name": "Sichuan",
      "name_zh": "四川",
      "api_value": "Sichuan",
      "com_province": "Sichuan",
      "seo_cp": "C1--CP_Sichuan",
      "cities_complete": false,
      "cities": [],
      "aliases": []
    },
    {
      "name": "Chongqing",
      "name_zh": "重庆",
      "api_value": "Chongqing",
      "com_province": "Chongqing",
      "seo_cp": "C1--CP_Chongqing",
      "cities_complete": false,
      "cities": [],
      "aliases": []
    },
    {
      "name": "Shaanxi",
      "name_zh": "陕西",
      "api_value": "Shaanxi",
      "com_province": "Shaanxi",
      "seo_cp": "C1--CP_Shaanxi",
      "cities_complete": false,
      "cities": [],
      "aliases": []
    },
    {
      "name": "Guangxi",
      "name_zh": "广西",
      "api_value": "Guangxi",
      "com_province": "Guangxi",
      "seo_cp": "C1--CP_Guangxi",
      "cities_complete": false,
      "cities": [],
      "aliases": [
        "Guangxi Zhuang",
        "广西"
      ]
    },
    {
      "name": "Shanxi",
      "name_zh": "山西",
      "api_value": "Shanxi",
      "com_province": "Shanxi",
      "seo_cp": "C1--CP_Shanxi",
      "cities_complete": false,
      "cities": [],
      "aliases": []
    },
    {
      "name": "Hainan",
      "name_zh": "海南",
      "api_value": "Hainan",
      "com_province": "Hainan",
      "seo_cp": "C1--CP_Hainan",
      "cities_complete": false,
      "cities": [],
      "aliases": []
    },
    {
      "name": "Yunnan",
      "name_zh": "云南",
      "api_value": "Yunnan",
      "com_province": "Yunnan",
      "seo_cp": "C1--CP_Yunnan",
      "cities_complete": false,
      "cities": [],
      "aliases": []
    },
    {
      "name": "Gansu",
      "name_zh": "甘肃",
      "api_value": "Gansu",
      "com_province": "Gansu",
      "seo_cp": "C1--CP_Gansu",
      "cities_complete": false,
      "cities": [],
      "aliases": []
    },
    {
      "name": "Hongkong S.A.R.",
      "name_zh": "香港",
      "api_value": "Hongkong",
      "com_province": "Hongkong S.A.R.`（待验证）",
      "seo_cp": "C1--CP_Hongkong",
      "cities_complete": false,
      "cities": [],
      "aliases": [
        "Hong Kong",
        "HongKong",
        "香港"
      ]
    },
    {
      "name": "Inner Mongolia",
      "name_zh": "内蒙古",
      "api_value": "InnerMongolia",
      "com_province": "Inner Mongolia`（待验证）",
      "seo_cp": "C1--CP_InnerMongolia",
      "cities_complete": false,
      "cities": [],
      "aliases": [
        "Nei Mongol",
        "内蒙古"
      ]
    },
    {
      "name": "Jilin",
      "name_zh": "吉林",
      "api_value": "Jilin",
      "com_province": "Jilin",
      "seo_cp": "C1--CP_Jilin",
      "cities_complete": false,
      "cities": [],
      "aliases": []
    },
    {
      "name": "Guizhou",
      "name_zh": "贵州",
      "api_value": "Guizhou",
      "com_province": "Guizhou",
      "seo_cp": "C1--CP_Guizhou",
      "cities_complete": false,
      "cities": [],
      "aliases": []
    },
    {
      "name": "Heilongjiang",
      "name_zh": "黑龙江",
      "api_value": "Heilongjiang",
      "com_province": "Heilongjiang",
      "seo_cp": "C1--CP_Heilongjiang",
      "cities_complete": false,
      "cities": [],
      "aliases": []
    },
    {
      "name": "Xinjiang",
      "name_zh": "新疆",
      "api_value": "Xinjiang",
      "com_province": "Xinjiang",
      "seo_cp": "C1--CP_Xinjiang",
      "cities_complete": false,
      "cities": [],
      "aliases": [
        "Xinjiang Uygur",
        "新疆"
      ]
    },
    {
      "name": "Ningxia",
      "name_zh": "宁夏",
      "api_value": "Ningxia",
      "com_province": "Ningxia",
      "seo_cp": "C1--CP_Ningxia",
      "cities_complete": false,
      "cities": [],
      "aliases": [
        "Ningxia Hui",
        "宁夏"
      ]
    },
    {
      "name": "Taiwan, China",
      "name_zh": "台湾",
      "api_value": "Taiwan",
      "com_province": "Taiwan, China`（待验证）",
      "seo_cp": "C1--CP_Taiwan",
      "cities_complete": false,
      "cities": [],
      "aliases": [
        "Taiwan",
        "台湾"
      ]
    },
    {
      "name": "Qinghai",
      "name_zh": "青海",
      "api_value": "Qinghai",
      "com_province": "Qinghai`（待验证）",
      "seo_cp": "C1--CP_Qinghai",
      "cities_complete": false,
      "cities": [],
      "aliases": []
    }
  ]
};
