import dotenv from 'dotenv';
dotenv.config({ path: 'D:\code\anaconda3\envs\paperfeed\notion-feeder\.env' });

console.log(process.env);  // 打印所有环境变量

const {
    NOTION_API_TOKEN,
    NOTION_READER_DATABASE_ID,
    NOTION_FEEDS_DATABASE_ID,
    CI,
} = process.env;

console.log(NOTION_API_TOKEN);
console.log(NOTION_READER_DATABASE_ID);
console.log(NOTION_FEEDS_DATABASE_ID);
console.log(CI);
