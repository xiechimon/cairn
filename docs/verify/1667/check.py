from pathlib import Path
import unittest
import struct
import re

class Showcase(unittest.TestCase):
    def test_shared_generated_assets(self):
        site = Path('site/index.html').read_text()
        section = site.split('<section id="showcase">')[1].split('</section>')[0]
        for name in ('bootstrap-loop', 'app-from-scratch', 'harness-comparison'):
            asset = f'media/showcase/{name}.png'
            self.assertIn(asset, section)
            self.assertTrue(Path('site', asset).is_file())
            width, height = struct.unpack('>II', Path('site', asset).read_bytes()[16:24])
            tag = re.search(r'<img[^>]+src="' + re.escape(asset) + r'"[^>]*>', section).group()
            self.assertIn(f'width="{width}"', tag)
            self.assertIn(f'height="{height}"', tag)
            for readme in ('README.md', 'README.zh.md'):
                self.assertIn('site/' + asset, Path(readme).read_text())
        self.assertIn('AI-generated concept art', section)
        self.assertNotIn('class="chart"', section)
        self.assertNotIn('class="kb"', section)
        self.assertNotIn('class="app"', section)

unittest.main()
