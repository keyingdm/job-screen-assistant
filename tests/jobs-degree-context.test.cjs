'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const J = require('../extension/jobs-core.js');
const ageTiers = '本科不超过24周岁，硕士不超过30周岁，博士不超过35周岁';
const normalize = requirements => J.normalize({ id: 'fictional-degree-context', name: '虚构语境岗位', requirements });

test('分学历年龄上限本身不构成学历门槛或学历冲突', () => {
  const degree = J.degreeInfo(ageTiers);
  assert.equal(degree.rank, 0); assert.equal(degree.label, '未明确');
  assert.doesNotMatch(degree.label, /不一致|冲突/);
});

test('只有分层年龄时学历资格保持待核对且年龄原文仍可查看', () => {
  const job = normalize(ageTiers), result = J.evaluate(job, { degree: '本科' });
  const degree = result.checks.find(check => check.label === '学历');
  assert.equal(degree.state, 'review'); assert.match(degree.reason, /未找到明确/);
  assert.equal(job.requirements, ageTiers); assert.match(job.facts.other, /24周岁.*30周岁.*35周岁/);
});

test('同片段明确本科及以上学历与年龄上限仍识别本科门槛', () => {
  const degree = J.degreeInfo('本科及以上学历且年龄不超过24周岁');
  assert.equal(degree.rank, 2); assert.equal(degree.minimum, true); assert.equal(degree.uncertain, false);
});

test('独立本科门槛不被后续三层年龄改成学历冲突', () => {
  const degree = J.degreeInfo('学历要求：本科及以上；年龄要求：' + ageTiers);
  assert.equal(degree.rank, 2); assert.equal(degree.minimum, true); assert.equal(degree.uncertain, false);
  assert.doesNotMatch(degree.evidence, /30周岁|35周岁/);
});

test('独立硕士门槛不被本科年龄分支降低', () => {
  const degree = J.degreeInfo('硕士及以上学历。' + ageTiers);
  assert.equal(degree.rank, 3); assert.equal(degree.minimum, true); assert.equal(degree.uncertain, false);
});

test('确实互相不同的明确学历表述仍保留冲突提示', () => {
  const degree = J.degreeInfo('本科学历；硕士学历');
  assert.equal(degree.rank, 2); assert.equal(degree.uncertain, true); assert.match(degree.label, /不一致/);
});

test('年龄和英语分层都不推断学历但英语仍按用户学历分支核对', () => {
  const requirements = ageTiers + '；本科生英语四级，硕士生英语六级，博士生英语六级';
  assert.equal(J.degreeInfo(requirements).rank, 0);
  assert.equal(J.englishInfo(requirements, '本科').rank, 1);
  assert.equal(J.englishInfo(requirements, '硕士').rank, 2);
  assert.equal(J.englishInfo(requirements, '博士').rank, 2);
});

test('明确博士学历门槛与独立年龄英语要求仍各自保留', () => {
  const requirements = '博士研究生学历；年龄不超过35周岁；英语六级';
  const degree = J.degreeInfo(requirements);
  assert.equal(degree.rank, 4); assert.equal(degree.uncertain, false);
  assert.equal(J.englishInfo(requirements, '博士').rank, 2);
  assert.equal(normalize(requirements).facts.experience.min, null);
});
