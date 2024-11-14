import { Client } from '@notionhq/client';
import Parser from 'rss-parser';

const NOTION_API_TOKEN = "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";
const NOTION_READER_DATABASE_ID = "131a053c64d78122bdf3c5724189a88e";
const NOTION_FEEDS_DATABASE_ID = "131a053c64d78192be54c5482d11b982";
const RUN_FREQUENCY = 86400 * 30;

const notion = new Client({
  auth: NOTION_API_TOKEN,
});

async function getFeedUrlsFromNotion() {
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
    title: item.properties.Title.title[0].plain_text,
    feedUrl: item.properties.Link.url,
    feedsId: item.id,
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

async function getPubDateFromitem(item) {
  const originpubDate = item.pubDate;
  const pubDate = new Date(originpubDate).toISOString();
  return pubDate;
}

async function processFeeds() {
  try {
    const Feeds = await getFeedUrlsFromNotion();

    // 并行获取新 Feed 项目
    const feedItemsPromises = Feeds.map(async (feed) => {
      const newFeedItems = await getNewFeedItemsFrom(feed.feedUrl);
      const feedid = feed.feedsId;

      // 并行创建 Notion 页面
      const createPagePromises = newFeedItems.map(async (item) => {
        const pubDate = await getPubDateFromFeedUrl(feed.feedUrl);

        // 如果 pubDate 是 null，设置默认值或跳过该条目
        if (!pubDate) {
          console.warn(`Skipping page creation for item "${item.title}" due to missing pubDate`);
          const pubDate = []; 
        }

        await notion.pages.create({
          parent: {
            database_id: NOTION_READER_DATABASE_ID,
          },
          properties: {
            Title: {
              title: [
                {
                  text: {
                    content: item.title,
                  },
                },
              ],
            },
            Link: {
              url: item.link,
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
          children: [],
        });
      });

      // 等待所有页面创建完成
      await Promise.all(createPagePromises);
    });

    // 等待所有 Feed 项目处理完成
    await Promise.all(feedItemsPromises);
  } catch (err) {
    console.error("Error processing feeds:", err);
  }
}



const feedurls = await getFeedUrlsFromNotion();
const item=await getNewFeedItemsFrom(feedurls[0].feedurl)[0];
//const pubdate=await getPubDateFromitem(item);
console.log(item);
//console.log(pubdate);