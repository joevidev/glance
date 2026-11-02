"""Crawl ~40 public sites with Playwright and save extracted clickable elements.

python -m glance_lab.data.crawl [--only substr] [--concurrency 5]
Output: data/sites/<site>__<n>.json = {site, url, viewport, elements}. No screenshots are saved.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import re
import sys
import time

from playwright.async_api import async_playwright

from glance_lab.common import ELEMENTS_JS, SITES

MIN_ELEMENTS = 12

# site key (registered domain-ish) -> list of urls (1-2 pages each)
SITE_URLS: dict[str, list[str]] = {
    "python.org": ["https://docs.python.org/3/", "https://docs.python.org/3/library/json.html"],
    "mozilla.org": ["https://developer.mozilla.org/en-US/docs/Web/HTML", "https://developer.mozilla.org/en-US/docs/Web/CSS"],
    "wikipedia.org": ["https://en.wikipedia.org/wiki/Eye_tracking", "https://en.wikipedia.org/wiki/Main_Page"],
    "ycombinator.com": ["https://news.ycombinator.com/", "https://news.ycombinator.com/news?p=2"],
    "stackoverflow.com": ["https://stackoverflow.com/questions", "https://stackoverflow.com/questions/tagged/python"],
    "github.com": ["https://github.com/microsoft/playwright", "https://github.com/python"],
    "toscrape.com": ["https://books.toscrape.com/", "https://quotes.toscrape.com/"],
    "saucedemo.com": ["https://www.saucedemo.com/"],
    "scrapingcourse.com": ["https://www.scrapingcourse.com/ecommerce/"],
    "data.gov": ["https://data.gov/", "https://catalog.data.gov/dataset"],
    "nasa.gov": ["https://www.nasa.gov/", "https://science.nasa.gov/"],
    "usa.gov": ["https://www.usa.gov/"],
    "gov.uk": ["https://www.gov.uk/", "https://www.gov.uk/browse/driving"],
    "npr.org": ["https://www.npr.org/", "https://text.npr.org/"],
    "bbc.com": ["https://www.bbc.com/news", "https://www.bbc.com/"],
    "theguardian.com": ["https://www.theguardian.com/international"],
    "reuters.com": ["https://www.reuters.com/"],
    "apnews.com": ["https://apnews.com/"],
    "lobste.rs": ["https://lobste.rs/", "https://lobste.rs/newest"],
    "arxiv.org": ["https://arxiv.org/", "https://arxiv.org/list/cs.CL/recent"],
    "stripe.com": ["https://stripe.com/pricing", "https://stripe.com/"],
    "vercel.com": ["https://vercel.com/pricing", "https://vercel.com/"],
    "notion.so": ["https://www.notion.so/pricing", "https://www.notion.so/"],
    "linear.app": ["https://linear.app/pricing", "https://linear.app/"],
    "figma.com": ["https://www.figma.com/pricing/"],
    "slack.com": ["https://slack.com/pricing"],
    "mailchimp.com": ["https://mailchimp.com/pricing/marketing/"],
    "duckduckgo.com": ["https://duckduckgo.com/", "https://duckduckgo.com/about"],
    "openstreetmap.org": ["https://www.openstreetmap.org/", "https://www.openstreetmap.org/about"],
    "google.com": ["https://www.google.com/", "https://about.google/"],
    "paulgraham.com": ["https://paulgraham.com/articles.html"],
    "overreacted.io": ["https://overreacted.io/"],
    "wikihow.com": ["https://www.wikihow.com/Main-Page"],
    "imdb.com": ["https://www.imdb.com/chart/top/"],
    "etsy.com": ["https://www.etsy.com/"],
    "ebay.com": ["https://www.ebay.com/"],
    "craigslist.org": ["https://sfbay.craigslist.org/"],
    "medium.com": ["https://medium.com/"],
    "reddit.com": ["https://old.reddit.com/", "https://old.reddit.com/r/programming/"],
    "npmjs.com": ["https://www.npmjs.com/package/react"],
    "pypi.org": ["https://pypi.org/", "https://pypi.org/project/requests/"],
    "huggingface.co": ["https://huggingface.co/models", "https://huggingface.co/docs"],
    "kaggle.com": ["https://www.kaggle.com/datasets"],
    "w3schools.com": ["https://www.w3schools.com/", "https://www.w3schools.com/html/"],
    "docker.com": ["https://docs.docker.com/", "https://www.docker.com/pricing/"],
    "tailwindcss.com": ["https://tailwindcss.com/docs/installation"],
    "react.dev": ["https://react.dev/", "https://react.dev/learn"],
    "nytimes.com": ["https://www.nytimes.com/"],
    "weather.gov": ["https://www.weather.gov/"],
    "archive.org": ["https://archive.org/"],
    "gutenberg.org": ["https://www.gutenberg.org/", "https://www.gutenberg.org/ebooks/"],
    "cloudflare.com": ["https://www.cloudflare.com/plans/"],
    "fireworks.ai": ["https://fireworks.ai/pricing", "https://fireworks.ai/"],
    "anthropic.com": ["https://www.anthropic.com/", "https://www.anthropic.com/pricing"],
}

VIEWPORTS = [(1440, 900), (1280, 800)]


def viewport_for(site: str, n: int) -> tuple[int, int]:
    # a few sites at 1280x800 (deterministic)
    return VIEWPORTS[1] if (sum(map(ord, site)) + n) % 6 == 0 else VIEWPORTS[0]


CONSENT_RE = r"^(accept( all)?( cookies)?|i agree|agree( and continue)?|got it|allow all|accept & continue|ok|yes, i agree|continue|reject all|dismiss|close)$"


async def dismiss_consent(page) -> None:
    """Best-effort: click cookie/consent buttons (main page + iframes), then hide leftover fixed overlays."""
    try:
        for fr in page.frames:
            try:
                btn = fr.get_by_role("button", name=re.compile(CONSENT_RE, re.I)).first
                if await btn.count():
                    await btn.click(timeout=1500)
                    await page.wait_for_timeout(600)
                    break
            except Exception:
                continue
        await page.evaluate("""() => {
          for (const f of document.querySelectorAll('iframe[src*="privacy"],iframe[src*="consent"],iframe[id*="sp_message"]')) f.remove();
          for (const e of document.querySelectorAll('body *')) {
            const cs = getComputedStyle(e);
            if (cs.position === 'fixed' || cs.position === 'sticky') {
              const r = e.getBoundingClientRect();
              if (r.width * r.height > 0.5 * innerWidth * innerHeight && /cookie|consent|privacy|gdpr|modal|overlay|banner/i.test((e.id||'')+' '+e.className)) e.remove();
            }
          }
        }""")
    except Exception:
        pass


async def crawl_page(browser, site: str, n: int, url: str, js: str, sem: asyncio.Semaphore) -> dict | None:
    vw, vh = viewport_for(site, n)
    async with sem:
        ctx = await browser.new_context(
            viewport={"width": vw, "height": vh},
            user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 GlanceResearchCrawler/0.1",
            locale="en-US",
        )
        page = await ctx.new_page()
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=25000)
            try:
                await page.wait_for_load_state("load", timeout=8000)
            except Exception:
                pass
            await page.wait_for_timeout(1500)
            await dismiss_consent(page)
            elements = await page.evaluate(js)
            final = page.url
            return {"site": site, "url": final, "viewport": {"w": vw, "h": vh}, "elements": elements}
        except Exception as e:  # log and move on
            print(f"FAIL {url}: {type(e).__name__}: {str(e)[:100]}", file=sys.stderr, flush=True)
            return None
        finally:
            await ctx.close()


async def main_async(only: str | None, concurrency: int) -> None:
    js = ELEMENTS_JS.read_text()
    SITES.mkdir(parents=True, exist_ok=True)
    sem = asyncio.Semaphore(concurrency)
    t0 = time.time()
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        jobs = []
        for site, urls in SITE_URLS.items():
            if only and only not in site:
                continue
            for n, url in enumerate(urls):
                jobs.append((site, n, url))

        async def run(site, n, url):
            path = SITES / f"{site}__{n}.json"
            try:
                res = await asyncio.wait_for(crawl_page(browser, site, n, url, js, sem), 70)
            except asyncio.TimeoutError:
                print(f"FAIL {url}: hard timeout", file=sys.stderr, flush=True)
                res = None
            if res is None:
                path.unlink(missing_ok=True)   # never keep a stale file from an older extractor/crawl
            if res is None:
                return site, n, url, None
            k = len(res["elements"])
            if k < MIN_ELEMENTS:
                path.unlink(missing_ok=True)
                print(f"DROP {url}: only {k} elements", flush=True)
                return site, n, url, None
            path.write_text(json.dumps(res, ensure_ascii=False))
            print(f"OK   {site}__{n} {k} elements ({url})", flush=True)
            return site, n, url, k

        results = await asyncio.gather(*(run(*j) for j in jobs))
        await browser.close()
    ok = [r for r in results if r[3]]
    sites = {r[0] for r in ok}
    print(f"\n{len(ok)}/{len(results)} pages ok, {len(sites)} sites, {time.time()-t0:.0f}s", flush=True)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only")
    ap.add_argument("--concurrency", type=int, default=5)
    a = ap.parse_args()
    asyncio.run(main_async(a.only, a.concurrency))


if __name__ == "__main__":
    main()
