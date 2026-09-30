"""Explicit opt-in live check; only synthetic business context is sent to AI."""
import argparse
import asyncio
import json
import tempfile
from pathlib import Path
from app.ai.research import analyze
from app.ai.service import AIServiceError


async def main():
    result = await asyncio.wait_for(analyze(
        'Research on retail inventory record accuracy: compare cycle counting and RFID, study methods and limitations',
        {'card:data': {'text':'Synthetic acceptance example: weekly inventory counts are available.', 'confirmed':False}}, 'en'), 100)
    path = Path(tempfile.gettempdir())/'solvex-quality-live-check.json'
    path.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'report':str(path),'sources':len(result['sources']), 'insights':len(result['insights']),
                      'comparisons':len(result['comparisons']),
                      'metadata_matched':sum(s['metadata']['status']=='matched' for s in result['sources'])}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--live',action='store_true'); args=parser.parse_args()
    if not args.live: parser.error('--live is required; this check consumes API usage')
    try: asyncio.run(main())
    except AIServiceError as exc:
        print(json.dumps({'error':exc.code,'message':exc.message})); raise SystemExit(1)
