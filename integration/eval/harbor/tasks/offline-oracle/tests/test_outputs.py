from pathlib import Path


def test_hello_file():
    assert Path("/app/hello.txt").read_text() == "hello\n"
