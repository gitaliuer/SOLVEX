"""Bounded lookup of publisher metadata; never fetch a URL supplied by a model."""
import asyncio
import json
import re
from datetime import date
from urllib.parse import quote, unquote, urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

from app.db import now


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def source_doi(url):
    parsed = urlsplit(url)
    path = unquote(parsed.path)
    if parsed.hostname in ('doi.org', 'dx.doi.org'):
        value = path.lstrip('/')
    elif parsed.hostname in ('onlinelibrary.wiley.com', 'journals.sagepub.com', 'www.tandfonline.com',
                             'pubs.acs.org', 'www.science.org', 'link.springer.com'):
        match = re.fullmatch(r'/(?:doi/(?:abs/|full/|pdf/|epdf/)?|article/)(10\.\d{4,9}/.+)', path)
        value = match.group(1) if match else ''
    else:
        return None
    return value if re.fullmatch(r'10\.\d{4,9}/[^\s?#]{1,180}', value) else None


def publication_date(message):
    for key in ('published', 'published-online', 'published-print'):
        try:
            parts = message[key]['date-parts'][0]
            if not 1 <= len(parts) <= 3 or any(type(n) is not int for n in parts):
                continue
            year, month, day = (parts + [1, 1])[:3]
            if not 1500 <= year <= date.today().year + 1:
                continue
            date(year, month, day)
            return '-'.join([str(year), f'{month:02}', f'{day:02}'][:len(parts)])
        except (KeyError, IndexError, TypeError, ValueError):
            continue
    return None


def crossref(doi):
    url = 'https://api.crossref.org/works/' + quote(doi, safe='')
    request = Request(url, headers={'Accept': 'application/json', 'User-Agent': 'SOLVEX/1.0 (source-metadata)'})
    # The endpoint is fixed, proxies and redirects are disabled, and bodies bounded.
    opener = build_opener(ProxyHandler({}), NoRedirect())
    with opener.open(request, timeout=5) as response:
        body = response.read(524289)
    if len(body) > 524288:
        raise ValueError('Metadata too large')
    message = json.loads(body)['message']
    if not isinstance(message, dict) or str(message.get('DOI', '')).lower() != doi.lower():
        raise ValueError('DOI mismatch')
    venue = message.get('container-title', [])
    return {'status': 'matched', 'provider': 'Crossref', 'url': url, 'checked_at': now(),
            'doi': doi, 'published_at': publication_date(message),
            'document_type': str(message.get('type', 'unknown'))[:80],
            'publisher': str(message.get('publisher', ''))[:250],
            'venue': str(venue[0])[:250] if isinstance(venue, list) and venue else '',
            'peer_review': 'not_verified', 'retraction_check': 'not_performed'}


async def enrich(sources):
    semaphore = asyncio.Semaphore(2)

    async def one(source):
        doi = source_doi(source['url'])
        metadata = {'status': 'unavailable', 'peer_review': 'not_verified', 'retraction_check': 'not_performed'}
        if doi:
            try:
                async with semaphore:
                    metadata = await asyncio.wait_for(asyncio.to_thread(crossref, doi), timeout=6)
            except Exception:
                metadata['status'] = 'lookup_failed'
        source['metadata'] = metadata
        source['published_at'] = metadata.get('published_at')

    await asyncio.gather(*(one(source) for source in sources[:6]))
    for source in sources[6:]:
        source['metadata'] = {'status': 'not_checked'}
