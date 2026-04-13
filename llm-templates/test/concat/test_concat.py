import glob
import math
from pathlib import Path
import itertools as it
import argparse

try:
    import tqdm

    ENABLE_PROGRESSBAR = True
except ImportError:
    ENABLE_PROGRESSBAR = False


def concat_text_by_pattern(
    source_dir: str = "",
    source_pattern: str = "",
    target_dir: str = "",
    target_prefix: str = "concat",
    concat_size: int = 500,
):

    def even_chunk(iterable, chunk_size):
        iterator = iter(iterable)
        slicer = iter(lambda: list(it.islice(iterator, chunk_size)), [])
        yield from slicer

    text_files = list(sorted(Path(source_dir).glob(f"{source_pattern}")))
    text_file_groups = even_chunk(text_files, concat_size)

    target_file_num = math.ceil(len(text_files) / concat_size)
    target_file_digits = len(str(target_file_num))

    print(f"{target_file_num} Files to create...")

    if ENABLE_PROGRESSBAR:
        progress = tqdm.trange(target_file_num)
    else:
        progress = range(target_file_num)

    Path(target_dir).mkdir(parents=True, exist_ok=True)
    for p, (i, text_file_group) in zip(progress, enumerate(text_file_groups)):
        target_filename = f"{target_prefix}{i+1:0>{target_file_digits}d}.txt"
        target_file = Path(target_dir).joinpath(target_filename)
        with open(target_file, "a+") as target_f:
            for text_file in text_file_group:
                with open(text_file, "r") as source_f:
                    src_text = source_f.read()
                target_f.write(src_text)
                target_f.write("\n")

        with open(target_file, "a+") as target_f:
            for text_file in text_file_group:
                with open(text_file, "r") as source_f:
                    src_text = source_f.read()
                target_f.write(src_text)
                target_f.write("\n")
        if not ENABLE_PROGRESSBAR:
            print(f"[{i+1}/{target_file_num}] {target_filename}")


def test_concat():
    print("start")
    cwd = Path(__file__).parent
    concat_text_by_pattern(
        source_dir=cwd,
        source_pattern="MPA*",
        target_dir=cwd.joinpath("concat"),
        concat_size=3,
    )
    assert True
