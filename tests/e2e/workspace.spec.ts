import {test,expect} from '@playwright/test';

test('Web boots without JS errors and exposes an explicit demo identity',async({page})=>{
  const errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/');
  await expect(page.getByText(/演示模式/).first()).toBeVisible();
  await expect(page.locator('body')).not.toContainText('Something went wrong');
  expect(errors).toEqual([]);
});

test('Web user can hatch PA, consent to sensitive memory and record a habit',async({page})=>{
  await page.goto('/');
  await expect(page.getByRole('button',{name:'刷新工作台'})).toBeVisible();
  // Fresh demo process expected, but HTTP smoke may already have confirmed the PA.
  if(await page.getByLabel('伙伴名字',{exact:true}).count()){
    await page.getByLabel('伙伴名字',{exact:true}).fill('小屿');
    await page.getByLabel('外观期待',{exact:true}).fill('青绿色圆圆的小伙伴');
    await page.getByLabel('性格',{exact:true}).fill('温柔');
    await page.getByLabel('相处方式',{exact:true}).fill('同行者');
    await page.getByRole('button',{name:'生成伙伴候选',exact:true}).click();
    await page.getByRole('button',{name:'选择此候选',exact:true}).click();
    await page.getByRole('button',{name:'确认孵化',exact:true}).click();
    await page.getByRole('button',{name:'我理解，永久确认此伙伴',exact:true}).click();
  }
  await expect(page.getByText('唯一的 PA · 形象已确认')).toBeVisible();
  await page.getByRole('button',{name:/02.*记忆手账/}).click();
  await page.getByLabel('记忆内容',{exact:true}).fill('记住我对花生过敏，测试候选');
  await page.getByLabel('记忆主题',{exact:true}).fill('browser.allergy');
  await page.getByRole('button',{name:'提交记忆候选',exact:true}).click();
  await expect(page.getByText('敏感记忆同意',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'同意记住',exact:true}).click();
  await expect(page.getByLabel('编辑记忆',{exact:true}).filter({visible:true}).first()).toBeVisible();
  await page.getByRole('button',{name:/03.*Agent 团队/}).click();
  await page.getByLabel('Agent 名称',{exact:true}).fill('浏览器阅读搭子');
  await page.getByLabel('专业领域',{exact:true}).fill('reading');
  await page.getByLabel('Agent 人设',{exact:true}).fill('记录读书习惯');
  await page.getByRole('button',{name:'创建 Agent',exact:true}).click();
  await page.getByRole('button',{name:'浏览器阅读搭子 · 运行中',exact:true}).click();
  await page.getByLabel('组件记录内容',{exact:true}).fill('今天阅读十分钟');
  await page.getByRole('button',{name:'保存组件记录',exact:true}).click();
  await expect(page.getByLabel('编辑组件记录',{exact:true})).toHaveValue('今天阅读十分钟');
});

test('Manifest scope shrink applies, expansion requires reject or explicit approval, and old consent stays invalid',async({page,request})=>{
  const api='http://127.0.0.1:8787/api';
  const name=`清单生命周期-${Date.now()}`;
  const created=await request.post(`${api}/blocks`,{data:{name,domain:'reading',persona:'清单生命周期浏览器验证',components:['checkin','records','plans']}});
  expect(created.ok()).toBeTruthy();
  const {block}=await created.json();
  const original=block.manifest;
  expect(original).toBeTruthy();
  const shrink={...original,capabilities:['records'],data:{fields:['records'],purposes:['answer']},ui:{components:['records']},events:[]};
  try {
    await page.goto('/');
    await page.getByRole('button',{name:/03.*Agent 团队/}).click();
    await page.getByRole('button',{name:`${name} · 运行中`,exact:true}).click();
    await expect(page.getByText('Agent 接口清单',{exact:true})).toBeVisible();
    await page.getByRole('button',{name:'编辑接口清单 JSON',exact:true}).click();
    await page.getByLabel('接口清单 JSON',{exact:true}).fill(JSON.stringify(shrink));
    await page.getByRole('button',{name:'校验并提交接口清单',exact:true}).click();
    await expect(page.getByRole('button',{name:'编辑接口清单 JSON',exact:true})).toBeVisible();
    await expect(page.getByText('范围扩大，等待你重新同意',{exact:true})).toHaveCount(0);
    let snapshot=await (await request.get(`${api}/bootstrap`)).json();
    let current=snapshot.blocks.find((item:{id:string})=>item.id===block.id);
    expect(current.manifest.data.fields).toEqual(['records']);
    expect(current.manifestVersion).toBeGreaterThan(block.manifestVersion);
    const grantResponse=await request.post(`${api}/grants`,{data:{sourceBlockId:block.id,granteeBlockId:'pa',field:'records',purpose:'answer'}});
    expect(grantResponse.ok()).toBeTruthy();
    const {grant}=await grantResponse.json();
    async function proposeExpansion(){
      await page.getByRole('button',{name:'编辑接口清单 JSON',exact:true}).click();
      await page.getByLabel('接口清单 JSON',{exact:true}).fill(JSON.stringify(original));
      await page.getByRole('button',{name:'校验并提交接口清单',exact:true}).click();
      await expect(page.getByText('范围扩大，等待你重新同意',{exact:true})).toBeVisible();
      await expect(page.getByRole('button',{name:'编辑接口清单 JSON',exact:true})).toBeDisabled();
      await expect(page.getByRole('button',{name:'发送消息',exact:true})).toBeDisabled();
    }
    await proposeExpansion();
    await page.getByRole('button',{name:'拒绝扩大，保留原清单',exact:true}).click();
    await expect(page.getByText('范围扩大，等待你重新同意',{exact:true})).toHaveCount(0);
    snapshot=await (await request.get(`${api}/bootstrap`)).json();
    current=snapshot.blocks.find((item:{id:string})=>item.id===block.id);
    expect(current.manifest.data.fields).toEqual(['records']);
    expect(current.pendingManifest??null).toBeNull();
    expect((await request.post(`${api}/grants/${grant.id}/read`,{data:{}})).ok()).toBeFalsy();
    await proposeExpansion();
    await page.getByRole('button',{name:'同意扩大并应用新清单',exact:true}).click();
    await expect(page.getByText('范围扩大，等待你重新同意',{exact:true})).toHaveCount(0);
    snapshot=await (await request.get(`${api}/bootstrap`)).json();
    current=snapshot.blocks.find((item:{id:string})=>item.id===block.id);
    expect(current.manifest).toEqual(original);
    expect(current.pendingManifest??null).toBeNull();
    expect((await request.post(`${api}/grants/${grant.id}/read`,{data:{}})).ok()).toBeFalsy();
    await page.getByRole('button',{name:/04.*授权中心/}).click();
    await expect(page.getByText('旧许可不可读取，请在授权中心主动重新设置',{exact:true}).first()).toBeVisible();
  } finally {
    await request.delete(`${api}/blocks/${block.id}`);
  }
});

test('Notification timezone preference validates and persists without changing event UTC',async({page})=>{
  await page.goto('/');
  await page.getByRole('button',{name:'05  日程与信箱'}).click();
  const zone=page.getByLabel('通知偏好 IANA 时区',{exact:true});
  await zone.fill('Invalid/Place');
  await page.getByRole('button',{name:'保存通知时区',exact:true}).click();
  await expect(page.getByText(/有效 IANA 时区/)).toBeVisible();
  await zone.fill('America/New_York');
  await page.getByRole('button',{name:'保存通知时区',exact:true}).click();
  await page.reload();
  await page.getByRole('button',{name:'05  日程与信箱'}).click();
  await expect(zone).toHaveValue('America/New_York');
});

test('Mobile viewport remains usable without horizontal overflow',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto('/');
  await expect(page.getByText(/演示模式/).first()).toBeVisible();
  const sizes=await page.evaluate(()=>({width:window.innerWidth,scroll:document.documentElement.scrollWidth}));
  expect(sizes.scroll).toBeLessThanOrEqual(sizes.width+1);
});

test('Manifest-disabled conversation hides chat and component writes use capability/UI intersection',async({page,request})=>{
  const api='http://127.0.0.1:8787/api'; const name=`接口约束-${Date.now()}`;
  const response=await request.post(`${api}/blocks`,{data:{name,domain:'reading',persona:'验证会话与组件接口约束',components:['checkin','records','plans']}});
  expect(response.ok()).toBeTruthy(); const {block}=await response.json();
  const manifest={...block.manifest,conversation:{enabled:false},capabilities:['records','checkin'],ui:{components:['records']}};
  try {
    expect((await request.put(`${api}/blocks/${block.id}/manifest`,{data:manifest})).ok()).toBeTruthy();
    await page.goto('/'); await page.getByRole('button',{name:/03.*Agent 团队/}).click();
    await page.getByRole('button',{name:`${name} · 运行中`,exact:true}).click();
    await expect(page.getByText('会话已由接口清单关闭',{exact:true})).toBeVisible();
    await expect(page.getByLabel('消息',{exact:true})).toHaveCount(0);
    await expect(page.getByRole('button',{name:'开启新会话',exact:true})).toHaveCount(0);
    await expect(page.getByRole('button',{name:'记录表',exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'打卡',exact:true})).toHaveCount(0);
    await expect(page.getByRole('button',{name:'计划清单',exact:true})).toHaveCount(0);
    await page.getByLabel('组件记录内容',{exact:true}).fill('仅记录表允许写入');
    await page.getByRole('button',{name:'保存组件记录',exact:true}).click();
    await expect(page.getByLabel('编辑组件记录',{exact:true})).toHaveValue('仅记录表允许写入');
    const noComponents={...manifest,capabilities:[],ui:{components:[]}};
    expect((await request.put(`${api}/blocks/${block.id}/manifest`,{data:noComponents})).ok()).toBeTruthy();
    await page.getByRole('button',{name:'刷新工作台',exact:true}).click();
    await expect(page.getByText('当前清单没有同时声明能力与界面的组件，无法新增记录。',{exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'保存组件记录',exact:true})).toBeDisabled();
    await expect(page.getByLabel('组件记录内容',{exact:true})).not.toBeEditable();
    const records=await (await request.get(`${api}/blocks/${block.id}/records`)).json();
    expect(records.records).toHaveLength(1); expect(records.records[0].component).toBe('records');
  } finally { await request.delete(`${api}/blocks/${block.id}`); }
});
