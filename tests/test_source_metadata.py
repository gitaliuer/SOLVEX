import unittest
from unittest.mock import patch

from app.ai.source_metadata import source_doi, publication_date, crossref, enrich


class MetadataTest(unittest.IsolatedAsyncioTestCase):
    def test_exact_doi_host_and_date_precision(self):
        self.assertEqual(source_doi('https://doi.org/10.1234/test'), '10.1234/test')
        self.assertEqual(source_doi('https://onlinelibrary.wiley.com/doi/full/10.1111/poms.12010?utm_source=test'), '10.1111/poms.12010')
        self.assertEqual(source_doi('https://journals.sagepub.com/doi/10.3233/RFT-150069'), '10.3233/RFT-150069')
        for url in ('https://example.org/10.1234/test', 'https://doi.org.evil.test/10.1234/test', 'http://127.0.0.1/a'):
            self.assertIsNone(source_doi(url))
        self.assertEqual(publication_date({'published': {'date-parts': [[2021]]}}), '2021')
        self.assertEqual(publication_date({'published': {'date-parts': [[2021, 2]]}}), '2021-02')
        self.assertIsNone(publication_date({'published': {'date-parts': [[2021, 2, 30]]}}))
        self.assertIsNone(publication_date({'created': {'date-parts': [[2021]]}}))

    async def test_failed_metadata_does_not_invent_dates_or_drop_source(self):
        sources = [{'id':'s1','url':'https://doi.org/10.1234/test','published_at':None},
                   {'id':'s2','url':'https://example.org/paper/2025','published_at':None}]
        with patch('app.ai.source_metadata.crossref', side_effect=ValueError('Unavailable')) as lookup:
            await enrich(sources)
        lookup.assert_called_once_with('10.1234/test')
        self.assertEqual(sources[0]['metadata']['status'], 'lookup_failed')
        self.assertIsNone(sources[1]['published_at'])

    def test_mismatched_doi_is_not_accepted(self):
        with patch('app.ai.source_metadata.build_opener') as opener:
            opener.return_value.open.return_value.__enter__.return_value.read.return_value = b'{"message":{"DOI":"10.1234/different"}}'
            with self.assertRaises(ValueError): crossref('10.1234/test')


if __name__ == '__main__': unittest.main()
