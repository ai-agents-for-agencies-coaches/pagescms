# Learn — lesson authoring guide

Lessons in the `/learn` section of the app are plain markdown files in this
folder. There is no database and no admin screen: **add a file, commit, push,
and Vercel deploys it live in ~1 minute.**

## Folder layout

```
content/learn/
  getting-started/            ← a folder = a category
    01-reading-your-report.md ← a file  = one lesson
    02-editing-your-site.md
  local-seo/
    01-what-is-local-rank.md
```

- **Folder name** is the category and the first URL segment.
- **File name** (minus `.md`) is the lesson slug, e.g.
  `local-seo/01-what-is-local-rank.md` → `/learn/local-seo/01-what-is-local-rank`.
- The `01-`, `02-` number prefixes are just for keeping files tidy in the
  folder. Actual display order comes from the `order:` field, not the filename.

## Lesson file format

Every file is YAML frontmatter (the `--- … ---` block) followed by a markdown
body:

```markdown
---
title: How to add a service page
summary: Shown as the blurb on the lesson card.
order: 3
categoryLabel: Getting started
categoryOrder: 1
youtubeId: dQw4w9WgXcQ
---

Write the lesson here in normal markdown.

## A heading

- bullet points, **bold**, _italic_
- link to another lesson: [local rank](/learn/local-seo/01-what-is-local-rank)

![a screenshot](/learn-images/service-page.png)
```

### Frontmatter fields

| Field           | Purpose                                   | If omitted            |
| --------------- | ----------------------------------------- | --------------------- |
| `title`         | Lesson heading and card title             | Prettified filename   |
| `summary`       | Blurb on the `/learn` index card          | Blank                 |
| `order`         | Sort order **within** the category        | Sorted last (999)     |
| `categoryLabel` | Human-friendly name for the category      | Prettified folder name |
| `categoryOrder` | Sort order of the **category** itself     | Sorted last (999)     |
| `youtubeId`     | Unlisted YouTube id, embedded at the top  | No video (text only)  |

Keep `categoryLabel` and `categoryOrder` identical across every file in a folder
— the app reads them off the lessons in that category.

## Adding a video

1. Upload the video to YouTube and set visibility to **Unlisted**.
2. Copy the id from the URL: `https://youtube.com/watch?v=dQw4w9WgXcQ` → the id
   is `dQw4w9WgXcQ`.
3. Put it in `youtubeId:`. It embeds above the written body.

Leave `youtubeId` blank or remove the line for a text-only lesson.

## Deep links into the dashboard

Lessons can link straight to the section of the dashboard they describe using a
`dashboard:` link. These resolve to the **current client's** real routes when a
client views the lesson in their portal, so you never hardcode an owner/repo:

```markdown
[Open your Analytics](dashboard:analytics)
[Edit your content](dashboard:content)
[Back to Learn](dashboard:learn)
```

| Token                  | Goes to                                             |
| ---------------------- | --------------------------------------------------- |
| `dashboard:analytics`  | the client's Analytics dashboard                    |
| `dashboard:content`    | the CMS home (collections) on their default branch  |
| `dashboard:learn`      | the client's Learn portal                           |

In the global `/learn` view (before a client is selected) these fall back to the
projects home.

## Screenshots and images

- Drop image files in **`public/learn-images/`** and reference them by path:

  ```markdown
  ![The Analytics dashboard](/learn-images/analytics-overview.png)
  ```

- External URLs also work: `![alt](https://…/image.png)`.
- Only reference an image once the file actually exists, or it renders broken.

## Adding a new category

Just create a new folder under `content/learn/` and add at least one lesson
file. The category appears automatically, sorted by its `categoryOrder`.

## Publishing

```bash
git add content/learn/
git commit -m "Add lesson: how to add a service page"
git push
```

That's the whole process — the deploy picks it up automatically.
