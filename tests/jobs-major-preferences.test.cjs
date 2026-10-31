'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../extension/jobs-majors.js');
const profile = major => ({ major, degree: '本科' });
const majors = ['计算机科学与技术', '软件工程', '电子信息工程'];
const entryFor = (result, major) => result.entries.find(entry => entry.value.includes(major));

for (const label of ['优选专业', '优先专业', '专业优先', 'Preferred majors']) {
  for (const punctuation of ['', '：']) test(label + punctuation + '标题下的多行标签均为偏好并保留标题证据', () => {
    const value = label + punctuation + '\n' + majors.join('\n');
    const result = M.extract(value);
    assert.equal(result.entries.length, majors.length);
    assert.ok(result.entries.every(entry => entry.kind === 'preferred' && entry.source === 'field'));
    for (const major of majors) {
      const entry = entryFor(result, major); assert.ok(entry);
      assert.ok(entry.text.includes(label)); assert.ok(entry.text.includes(major));
      assert.equal(M.assess(value, profile(major)).state, 'review');
    }
    assert.equal(M.assess(value, profile('临床医学')).state, 'review');
  });

  test(label + '行内多专业保留偏好且不会将命中变成直接通过', () => {
    const value = label + '：计算机科学与技术，软件工程、电子信息工程';
    const result = M.extract(value);
    assert.equal(result.entries.length, 2);
    assert.ok(result.entries.every(entry => entry.kind === 'preferred' && entry.text.includes(label)));
    for (const major of majors) assert.equal(M.assess(value, profile(major)).state, 'review');
    assert.equal(M.assess(value, profile('法学')).state, 'review');
  });

  test(label + '行内首项后的换行标签继续继承偏好', () => {
    const value = label + '：计算机科学与技术\n软件工程\n电子信息工程';
    const result = M.extract(value);
    assert.equal(result.entries.length, 3);
    assert.ok(result.entries.every(entry => entry.kind === 'preferred' && entry.text.includes(label)));
  });

  test(label + '空标题本身不生成专业证据', () => {
    assert.equal(M.extract(label).known, false);
    assert.deepEqual(M.extract(label + '：').entries, []);
  });
}

for (const hard of ['专业要求\n法学', '专业要求：法学', '专业要求：法学，经济学']) {
  test('新的硬专业字段结束前面的偏好作用域：' + hard.replace(/\n/g, '/'), () => {
    const value = '优选专业：\n计算机科学与技术\n' + hard;
    const result = M.extract(value);
    assert.equal(entryFor(result, majors[0]).kind, 'preferred');
    assert.equal(entryFor(result, '法学').kind, 'required');
    assert.equal(M.assess(value, profile('法学')).state, 'pass');
    assert.equal(M.assess(value, profile(majors[0])).state, 'review');
    if (hard.includes('经济学')) assert.equal(entryFor(result, '经济学').kind, 'required');
  });
}

test('同一行的后续硬专业字段不被前面的偏好降级', () => {
  const value = '优选专业：计算机科学与技术，专业要求：法学、经济学';
  const result = M.extract(value);
  assert.equal(entryFor(result, majors[0]).kind, 'preferred');
  assert.equal(entryFor(result, '法学').kind, 'required');
  assert.equal(M.assess(value, profile('法学')).state, 'pass');
  assert.match(entryFor(result, '法学').text, /^专业要求：/);
});

for (const boundary of ['学历要求：本科', '工作经验：无需经验', '福利待遇', '备注：按原文核对', '任职要求']) {
  test('其它字段结束偏好而不降级后续硬专业：' + boundary, () => {
    const value = '优先专业：\n计算机科学与技术\n' + boundary + '\n法学专业';
    const result = M.extract(value);
    assert.equal(entryFor(result, majors[0]).kind, 'preferred');
    assert.equal(entryFor(result, '法学').kind, 'required');
    assert.equal(M.assess(value, profile('法学')).state, 'pass');
  });
}

for (const heading of ['岗位职责', '工作职责', '主要职责', '职位描述', '工作内容', 'Responsibilities', 'Job description']) {
  test('职责标题终止偏好且职责技能不变成专业证据：' + heading, () => {
    const value = '专业优先：\n计算机科学与技术\n' + heading + '\n负责维护软件工程设备\n熟悉电子信息工程专业知识\n任职要求\n法学专业';
    const result = M.extract(value);
    assert.equal(result.entries.length, 2);
    assert.equal(entryFor(result, majors[0]).kind, 'preferred');
    assert.equal(entryFor(result, '法学').kind, 'required');
    assert.equal(M.assess(value, profile('法学')).state, 'pass');
  });
}

test('偏好字段与要求正文之间不泄漏作用域并合并重复偏好证据', () => {
  const preferred = '优选专业：\n计算机科学与技术\n软件工程';
  const result = M.extract({ majorRequirements: preferred, requirements: preferred + '\n专业要求：法学' });
  assert.equal(result.entries.length, 3);
  assert.equal(entryFor(result, majors[0]).kind, 'preferred');
  assert.equal(entryFor(result, majors[1]).kind, 'preferred');
  assert.equal(entryFor(result, '法学').kind, 'required');
  const independent = M.extract({ majorRequirements: preferred, requirements: '法学专业' });
  assert.equal(entryFor(independent, '法学').kind, 'required');
});

test('偏好块内的排除保留原文并待核对而不推定资格拒绝', () => {
  const value = '优选专业：\n计算机科学与技术\n不接受法学专业';
  const result = M.extract(value);
  assert.equal(entryFor(result, majors[0]).kind, 'preferred');
  assert.equal(entryFor(result, '法学').kind, 'excluded');
  assert.ok(entryFor(result, '法学').text.includes('不接受法学专业'));
  assert.equal(entryFor(result, '法学').uncertain, true);
  assert.equal(M.assess(value, profile('法学')).state, 'review');
  assert.equal(M.assess(value, profile(majors[0])).state, 'review');
});

test('行内偏好附带括号排除只限定偏好范围', () => {
  const value = '优先专业：计算机科学与技术（法学除外）';
  const result = M.extract(value);
  assert.equal(entryFor(result, majors[0]).kind, 'preferred');
  assert.equal(entryFor(result, '法学').kind, 'excluded');
  assert.equal(entryFor(result, '法学').uncertain, true);
  assert.equal(M.assess(value, profile('法学')).state, 'review');
});

test('偏好标签不把技能或设备职责误识别为专业', () => {
  for (const value of [
    '优选专业：熟悉电气设备，掌握软件工具',
    '优先专业\n熟练掌握编程工具\n负责维护软件工程平台\n电子信息工程专业知识',
    '专业优先：\n技能要求：熟悉电气设备\n工作职责：参与设备维护'
  ]) assert.equal(M.extract(value).known, false, value);
});

test('原有条款尾部优先政策保持命中待核对及未命中不硬拒', () => {
  assert.equal(M.assess('软件工程专业优先', profile('软件工程')).state, 'review');
  assert.equal(M.assess('软件工程专业优先', profile('法学')).state, 'review');
  assert.equal(M.assess('不接受法学专业', profile('法学')).state, 'fail');
});

for (const label of ['优选专业', '优先专业', '专业优先', 'Preferred majors']) {
  for (const [style, body] of [
    ['行内中文括号', '：计算机科学与技术（法学除外）'],
    ['行内英文括号', ':计算机科学与技术(法学除外)'],
    ['换行排除', '\n计算机科学与技术\n法学除外']
  ]) test(label + style + '的排除只限制偏好而不成为资格硬排除', () => {
    const value = label + body, result = M.extract(value), excluded = entryFor(result, '法学');
    assert.equal(excluded.kind, 'excluded'); assert.equal(excluded.uncertain, true);
    assert.equal(excluded.preferenceContext, true); assert.ok(excluded.text.includes(label));
    const keyword = M.match(value, '法学', profile('法学'));
    assert.equal(keyword.hit, false); assert.equal(keyword.excluded, false); assert.equal(keyword.state, 'unknown');
    assert.equal(M.assess(value, profile('法学')).state, 'review');
    assert.equal(M.assess(value, profile('计算机科学与技术')).state, 'review');
  });
}

for (const value of [
  '优选专业：计算机科学与技术（法学除外）\n专业要求：法学除外',
  '优先专业\n计算机科学与技术\n法学除外\n专业要求\n法学除外',
  '优选专业：法学除外，专业要求：法学除外',
  '专业要求：法学除外\n优选专业：计算机科学与技术（法学除外）'
]) test('同名偏好排除不覆盖独立硬排除：' + value.replace(/\n/g, '/'), () => {
  const result = M.extract(value), negatives = result.entries.filter(entry => entry.kind === 'excluded' && entry.value.includes('法学'));
  assert.equal(negatives.length, 2);
  assert.ok(negatives.some(entry => entry.preferenceContext && entry.uncertain));
  assert.ok(negatives.some(entry => !entry.preferenceContext && !entry.uncertain));
  assert.equal(M.assess(value, profile('法学')).state, 'fail');
  assert.equal(M.match(value, '法学', profile('法学')).excluded, true);
});
