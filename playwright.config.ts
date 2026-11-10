import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir:'./tests/e2e',
  fullyParallel:false,
  workers:1,
  timeout:30_000,
  use:{baseURL:process.env.TEST_WEB_URL??'http://127.0.0.1:8081',headless:true,screenshot:'only-on-failure',trace:'retain-on-failure',launchOptions:process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{}},
  reporter:[['list'],['html',{open:'never'}]],
});
