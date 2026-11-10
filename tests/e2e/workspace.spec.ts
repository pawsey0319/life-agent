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

test('Mobile viewport remains usable without horizontal overflow',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto('/');
  await expect(page.getByText(/演示模式/).first()).toBeVisible();
  const sizes=await page.evaluate(()=>({width:window.innerWidth,scroll:document.documentElement.scrollWidth}));
  expect(sizes.scroll).toBeLessThanOrEqual(sizes.width+1);
});
