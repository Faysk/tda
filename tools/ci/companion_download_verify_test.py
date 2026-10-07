import hashlib
import io
import unittest
from unittest.mock import Mock
from companion_download_verify import verify_download


class Response(io.BytesIO):
    status = 200
    headers = {"Content-Length": "3", "Content-Disposition": 'attachment; filename="TDACompanion-x64.msi"'}

    def geturl(self):
        return "https://example.test/msi"


class DownloadVerificationTests(unittest.TestCase):
    def verify(self, response, sha=None):
        opener = Mock()
        opener.open.return_value = response
        verify_download(opener, "https://example.test/msi", 3,
                        sha or hashlib.sha256(b"abc").hexdigest())

    def test_valid_complete_download(self):
        self.verify(Response(b"abc"))

    def test_truncated_body(self):
        with self.assertRaisesRegex(ValueError, "BYTES_INVALID"):
            self.verify(Response(b"ab"))

    def test_wrong_digest(self):
        with self.assertRaisesRegex(ValueError, "BYTES_INVALID"):
            self.verify(Response(b"abc"), "0" * 64)

    def test_oversized_body(self):
        with self.assertRaisesRegex(ValueError, "OVERSIZED"):
            self.verify(Response(b"abcd"))

    def test_missing_length(self):
        response = Response(b"abc")
        response.headers = {"Content-Disposition": "attachment"}
        with self.assertRaisesRegex(ValueError, "LENGTH_INVALID"):
            self.verify(response)

    def test_inline_disposition(self):
        response = Response(b"abc")
        response.headers = {"Content-Length": "3", "Content-Disposition": "inline"}
        with self.assertRaisesRegex(ValueError, "DISPOSITION_INVALID"):
            self.verify(response)

    def test_redirected_response(self):
        response = Response(b"abc")
        response.geturl = lambda: "https://other.test/msi"
        with self.assertRaisesRegex(ValueError, "NOT_DIRECT"):
            self.verify(response)


if __name__ == "__main__":
    unittest.main()
