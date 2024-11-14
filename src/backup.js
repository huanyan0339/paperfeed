import { markdownToBlocks } from '@tryfabric/martian';
import TurndownService from 'turndown';
import dotenv from 'dotenv';
import { Client, LogLevel } from '@notionhq/client';
import Parser from 'rss-parser';
import pLimit from 'p-limit';



dotenv.config();

const NOTION_API_TOKEN="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"
const NOTION_READER_DATABASE_ID="131a053c64d78122bdf3c5724189a88e"
const NOTION_FEEDS_DATABASE_ID="131a053c64d78192be54c5482d11b982"
const DEEPL_API_KEY="c395219b-cb36-4342-adf0-e985c561b733"
const RUN_FREQUENCY=86400*365
const CI=false

const logLevel = CI ? LogLevel.INFO : LogLevel.DEBUG;
const DEEPL_API_URL = 'https://api.deepl.com/v2/translate';
const limit = pLimit(5); 

async function getFeedInfosFromNotion() {
    const notion = new Client({
        auth: NOTION_API_TOKEN,
        logLevel,
    });

    let response;
    try {
        response = await notion.databases.query({
            database_id: NOTION_FEEDS_DATABASE_ID,
            filter: {
                or: [
                    {
                        property: 'Enabled',
                        checkbox: {
                            equals: true,
                        },
                    },
                ],
            },
        });
    } catch (err) {
        console.error(err);
        return [];
    }

    const feeds = response.results.map((item) => ({
        feedUrl: item.properties.Link.url,
        feedId: item.id,
    }));

    return feeds;
}

async function getNewFeedItemsFrom(feedUrl) {
    const parser = new Parser();
    let rss;
    try {
        rss = await parser.parseURL(feedUrl);
    } catch (error) {
        console.error(error);
        return [];
    }

    const currentTime = new Date().getTime() / 1000;

    return rss.items.filter((item) => {
        const blogPublishedTime = new Date(item.pubDate).getTime() / 1000;
        
        // 如果有 content:encoded 或 content 字段，使用它
        const content = item['content:encoded'] || item.content || item.description || '';
        item.content = content;  // 确保 item 包含完整内容
        return (currentTime - blogPublishedTime) < RUN_FREQUENCY;
    });
}

async function getNewFeedItems() {
    let allNewFeedItems = [];
    const feeds = await getFeedInfosFromNotion();

    for (const { feedUrl,feedId } of feeds) {
        const feedItems = await getNewFeedItemsFrom(feedUrl);
        allNewFeedItems.push(...feedItems);
        feedItems.forEach(item => {
            item.feedId = feedId;
        });
    }
    allNewFeedItems.sort((a, b) => new Date(a.pubDate) - new Date(b.pubDate));
    return allNewFeedItems;
}


async function translateText(text, targetLang = 'ZH') {
    try {
        const response = await fetch(DEEPL_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                auth_key: DEEPL_API_KEY,
                text: text,
                target_lang: targetLang,
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();  // 捕获响应的错误消息
            console.error(`翻译请求失败: ${errorText}`);  // 打印错误消息
            throw new Error('翻译请求失败');
        }

        const data = await response.json();
        if (data.translations && data.translations[0] && data.translations[0].text) {
            return data.translations[0].text;
        } else {
            throw new Error('DeepL API 返回的数据格式不正确');
        }
    } catch (error) {
        console.error(`翻译失败: ${error.message}`);
        throw error;
    }
}


async function htmlToMarkdownJSON(htmlContent) {
    try {
        const turndownService = new TurndownService();
        const markdown = turndownService.turndown(htmlContent);  // 转换 HTML 为 Markdown
        return markdown
    } catch (error) {
        console.error('HTML to Markdown Conversion Error:', error);
        return {};
    }
}

function jsonToNotionBlocks(markdownContent) {
    return markdownToBlocks(markdownContent);
}

async function htmlToNotionBlocks(htmlContent) {
    const markdownJson = await htmlToMarkdownJSON(htmlContent);
    const notionBlocks = jsonToNotionBlocks(markdownJson);
    return notionBlocks
}

async function addFeedItemToNotion(notionItem) {
    const { translatedTitle, link, pubDate,feedid,translatedContentBlocks,titleBlocks,contentBlocks } = notionItem;

    const notion = new Client({
        auth: NOTION_API_TOKEN,
        logLevel,
    });

    try {
        await notion.pages.create({
            parent: {
                database_id: NOTION_READER_DATABASE_ID,
            },
            properties: {
                Title: {
                    title: [
                        {
                            text: {
                                content: translatedTitle,
                            },
                        },
                    ],
                },
                Link: {
                    url: link,
                },
                PubDate: {
                    date: {
                      start: pubDate,  // Only pass a valid date string here
                    },
                  },
                  Feeds: {
                    relation: [
                      {
                        id: feedid,
                      },
                    ],
                  },               
            },
            children: [...translatedContentBlocks,...titleBlocks,...contentBlocks],
        });
    } catch (err) {
        console.error(err);
    }
}

const feedItems = await getNewFeedItems();

// 使用 Promise.all 来并行处理
await Promise.all(feedItems.map(item => limit(async () => {
    try {
        const titleBlocks = item.title ? await htmlToNotionBlocks(item.title) : [];
        const translatedTitle = item.title ? await translateText(item.title) : '';
        const contentBlocks = item.content ? await htmlToNotionBlocks(item.content) : [];
        const translatedContent = item.content ? await translateText(item.content) : '';
        const translatedContentBlocks = translatedContent ? await htmlToNotionBlocks(translatedContent) : [];
        
        const notionItem = {
            translatedTitle,
            link: item.link,
            pubDate: new Date(item.pubDate).toISOString(),
            feedid: item.feedId,
            translatedContentBlocks,
            titleBlocks,
            contentBlocks,
        };
        await addFeedItemToNotion(notionItem);
    } catch (error) {
        console.error(`Error processing feed item '${item.title}':`, error);
    }
})));
console.log('Done!');