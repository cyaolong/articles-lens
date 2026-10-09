import test from 'node:test';
import assert from 'node:assert/strict';
import { Navigation, taskScreen } from '../ui/navigation.js';
test('只有完成或失败的部分报告进入结果页，分析中不暴露结果页',()=>{
  assert.equal(taskScreen({status:'analyzing',reports:[{}]}),'start');
  assert.equal(taskScreen({status:'error',reports:[{}]}),'result');
  assert.equal(taskScreen({status:'error',reports:[]}),'start');
  assert.equal(taskScreen({status:'done',reports:[{}]}),'result');
});
test('设置往返保持原页面和滚动位置，不被后台通知抢占',()=>{
  const nav=new Navigation();nav.move('result');nav.settings(460);
  assert.equal(nav.screen,'settings');nav.sync({status:'done',reports:[{}]});
  assert.equal(nav.screen,'settings');assert.equal(nav.back(),460);assert.equal(nav.screen,'result');
  nav.move('start');nav.settings(123);nav.sync({status:'ready',reports:[]});
  assert.equal(nav.back(),123);assert.equal(nav.screen,'start');
});
test('新读取替换旧结果，重新打开按任务状态恢复页面',()=>{
  const nav=new Navigation();nav.sync({status:'done',reports:[{}]});assert.equal(nav.screen,'result');
  nav.sync({status:'reading',reports:[]});assert.equal(nav.screen,'start');
  assert.equal(new Navigation().sync({status:'done',reports:[{}]}),true);
});
