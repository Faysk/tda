import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("prepare", Path(__file__).with_name("prepare-lore-assets.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class StaticSvgTests(unittest.TestCase):
    def test_static_svg(self):
        data = b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080"><rect width="20" height="20"/></svg>'
        self.assertEqual(module.check_svg(data)["width"], 1920)

    def test_active_and_external_resources_are_rejected(self):
        for body in ['<script/>', '<foreignObject/>', '<rect onload="run()"/>',
                     '<rect fill="URL(file:///secret)"/>', '<rect href="https://example.com"/>',
                     '<rect style="fill:red"/>', '<rect fill="url(#missing)"/>']:
            with self.subTest(body=body), self.assertRaises(ValueError):
                module.check_svg(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080">{body}</svg>'.encode())
        with self.assertRaises(ValueError):
            module.check_svg(b'<!DOCTYPE svg><svg/>')

if __name__ == "__main__":
    unittest.main()
