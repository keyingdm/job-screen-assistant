// Fictional examples only. Never bundle real candidates or recruitment snapshots.
globalThis.JobScreenSamples = [
  { id: 'sample-1', name: '嵌入式软件工程师（虚构）', org: '示例电子技术有限公司', positionSecondOrg: '示例科技集团', cityName: '深圳', positionType: 0, workNature: '全职', jobRequirements: '1. 本科及以上学历，2027届应届毕业生。\n2. 电子信息科学与技术、通信工程等相关专业。\n3. 英语四级及以上，熟悉 C/C++。', jobDescription: '负责嵌入式软件开发、调试与测试，配合硬件团队完成联调。', salaryRequirements: '五险一金，双休，餐补。', closeDate: '2099-10-31' },
  { id: 'sample-2', name: '算法工程师（虚构）', org: '示例智能研究院', positionSecondOrg: '示例科技集团', cityName: '武汉', positionType: 0, workNature: '全职', jobRequirements: '硕士及以上学历，2027届毕业生，计算机、数学相关专业。熟悉 Python 和机器学习。', jobDescription: '负责模型训练和算法验证。', salaryRequirements: '六险二金，弹性工作。', closeDate: '2099-11-12' },
  { id: 'sample-3', name: '技术支持工程师（虚构）', org: '示例系统服务有限公司', cityName: '南昌', positionType: 0, workNature: '全职', jobRequirements: '计算机或电子信息类相关专业，有较强的沟通能力。', jobDescription: '负责客户技术支持，需要出差和驻场。', salaryRequirements: '五险一金，出差补贴。' },
  { id: 'sample-4', name: '质量工程师（虚构）', org: '示例制造有限公司', cityName: '苏州', positionType: 0, workNature: '全职', jobRequirements: '本科及以上学历，3年以上质量管理工作经验。熟悉质量体系。', jobDescription: '负责产品质量与异常分析。', salaryRequirements: '五险一金，双休。', closeDate: '2099-11-05' },
  { id: 'sample-5', name: '软件测试实习生（虚构）', org: '示例软件有限公司', cityName: '上海', positionType: 0, workNature: '实习', jobRequirements: '本科及以上学历，2026-2027届毕业生。专业不限，经验不限。', jobDescription: '执行测试用例，记录缺陷。', salaryRequirements: '实习津贴，餐补。', closeDate: '2099-11-20' },
  { id: 'sample-6', name: '项目助理（已截止虚构示例）', org: '示例项目有限公司', cityName: '北京', positionType: 0, workNature: '全职', jobRequirements: '本科及以上学历，英语六级。', jobDescription: '协助项目沟通与文档整理。', closeDate: '2020-01-01', canDeliver: false }
].map((job, index) => ({ ...job, url: 'https://example.invalid/jobs/' + (index + 1) }));
