#!/usr/bin/env python3
import os, shutil, sys, time

assert len(sys.argv) >= 1 and all(isinstance(arg, str) for arg in sys.argv)

help_message = """
build.py [-hrw] [long_flags]* [root_dir]?

    default behaviour: builds from ./root_dir/src to ./root_dir/dst. the default
    root_dir is the working directory.

    -h, --help: print this message, then exit.

    -w, --watch: after building, continuously monitor ./root_dir/src, and live-rebuild
    into ./root_dir/dst when any files change. play a bell if any sub-commands fail.

    -r, --release: emit the production version of react(-dom).js rather than
    the development version, emit an empty file rather than live.js, minify .css and
    .js outputs, and don't emit a .js.map file.

    required command-line programs: google-closure-compiler, r.js.cmd, sass, tsc

    build actions:

        ./root_dir/dst/ is created if it doesn't exist, then cleared of all files

        appropriate react, require.js and live.js sources are copied from
        ./root_dir/resources/*.js to ./root_dir/dst/*.js

        other ./root_dir/resources/* are copied unchanged to ./root_dir/dst/

        ./root_dir/src/style.scss (and its imports) are compiled using sass, perhaps
        minified, then saved to the single file ./root_dir/dst/style.css

        ./root_dir/src/app.tsx (and its imports) are compiled using tsc, perhaps
        minified, then saved to the single file ./root_dir/dst/app.js

        ./root_dir/src/audioWorklet.ts is similarly compiled, bundled and minified
"""

# parse the command line, perhaps printing a help message
is_release = False
is_watch = False
root_dir = "."

if len(sys.argv) >= 2:
    # parse flags
    if sys.argv[-1].startswith("-"):
        last_flag_i = len(sys.argv)
    else:
        last_flag_i = len(sys.argv) - 1

    for raw_flag in sys.argv[1:last_flag_i]:
        flags = []

        if raw_flag.startswith("--"):
            flags.append(raw_flag)
        elif raw_flag.startswith("-"):
            for ch in raw_flag[1:]:
                if not ch in ["h", "w", "r"]:
                    print(f"unrecognized short flag -{ch}")
                    exit(1)

                flags.append("-" + ch)
        else:
            print(f"flag '{raw_flag}' does not start with '-'")
            exit(1)

        for flag in flags:
            if flag == "--release" or flag == "-r":
                is_release = True
            elif flag == "--watch" or flag == "-w":
                is_watch = True
            elif flag == "--help" or flag == "-h":
                print(help_message)
                exit(0)
            else:
                assert flag.startswith("--")
                print(f"unrecognized long flag {flag}")

    # parse the root_dir
    if not sys.argv[-1].startswith("-"):
        root_dir = os.path.join(".", sys.argv[-1])
        if not os.path.isdir(root_dir):
            print(f"'{root_dir}' is not a directory")
            exit(1)

src_dir = os.path.join(root_dir, "src")
resources_dir = os.path.join(root_dir, "resources")
dst_dir = os.path.join(root_dir, "dst")

if not os.path.isdir(src_dir):
    print(f"{src_dir} is not a directory")
    exit(1)

if not os.path.isdir(resources_dir):
    print(f"{resources_dir} is not a directory")
    exit(1)

# delete and then recreate dst_dir
if os.path.isdir(dst_dir):
    shutil.rmtree(dst_dir)

os.mkdir(dst_dir)

# copy resource files directly to dst_dir
def copy_resources():
    for src_path in os.listdir(src_dir):
        if src_path.endswith(".html"):
            copy_src = os.path.join(src_dir, src_path)
            copy_dst = os.path.join(dst_dir, os.path.basename(src_path))
            shutil.copyfile(copy_src, copy_dst)

    for resource_path in os.listdir(resources_dir):
        if not resource_path.endswith(".js"):
            copy_src = os.path.join(resources_dir, resource_path)
            copy_dst = os.path.join(dst_dir, os.path.basename(resource_path))
            shutil.copyfile(copy_src, copy_dst)

copy_resources()

# copy debug or release react sources to dst_dir. also, in release mode, write an empty file
# to dst_dir/live.js. in non-release mode, copy live.js to dst_dir/live.js
def copy_js_files():
    react_suffix = "production.min" if is_release else "development"

    shutil.copyfile(
        os.path.join(resources_dir, f"react.{react_suffix}.js"),
        os.path.join(dst_dir, "react.js"),
    )
    shutil.copyfile(
        os.path.join(resources_dir, f"react-dom.{react_suffix}.js"),
        os.path.join(dst_dir, "react-dom.js"),
    )

    shutil.copyfile(
        os.path.join(resources_dir, "require.js"),
        os.path.join(dst_dir, "require.js")
    )

    dst_live_js_path = os.path.join(dst_dir, "live.js")

    if is_release:
        open(dst_live_js_path, "a").close()
    else:
        shutil.copyfile(
            os.path.join(resources_dir, "live.js"),
            dst_live_js_path
        )

copy_js_files()

# compile src_dir/style.scss to dst_dir/style.css
def invoke_sass():
    src_scss_path = os.path.join(src_dir, "style.scss")
    dst_css_path = os.path.join(dst_dir, "style.css")

    if os.path.isfile(src_scss_path):
        sass_style_flag = "--style=compressed" if is_release else ""

        result = os.system(
            f"sass --no-source-map {sass_style_flag} {src_scss_path} {dst_css_path}"
        )

    return result

invoke_sass()

# compile src_dir/app.tsx (and its imports) to a temporary directory. (we deliberately
# do this after updating html, css and resources, because it's the slowest step)
def invoke_tsc():
    tmp_dir = os.path.join(dst_dir, "tmp")
    os.mkdir(tmp_dir)

    src_tsx_path = os.path.join(src_dir, "app.tsx")
    audio_worklet_ts_path = os.path.join(src_dir, "audioWorklet.ts")

    source_map_flag = "" if is_release else "--sourceMap"
    result = os.system(
        "tsc --strict --target es6 --jsx react --module amd "
        f"{source_map_flag} --esModuleInterop --removeComments --skipLibCheck "
        f"{src_tsx_path} {audio_worklet_ts_path} --outDir {tmp_dir}"
    )

    # in release mode, minify and bundle the resulting source files
    dst_app_js_path = os.path.join(dst_dir, "app.js")

    if is_release:
        # collate sources from many files to a single file (app only, not audioWorklet)
        os.system(
            f"r.js.cmd -o baseUrl={tmp_dir} name=app "
            f"out={os.path.join(tmp_dir, 'app.collated.js')} "
            f"paths.react=empty: paths.react-dom=empty: optimize=none logLevel=4 "
        )

        shutil.copy(
            os.path.join(tmp_dir, "audioWorklet.js"),
            os.path.join(tmp_dir, "audioWorklet.collated.js"),
        )

        for root_name in ["app", "audioWorklet"]:
            # minify that single file
            collated_path = os.path.join(tmp_dir, root_name + ".collated.js")
            dst_path = os.path.join(dst_dir, root_name + ".js")

            os.system(
                f"google-closure-compiler --language_in ECMASCRIPT_2016 "
                f"--language_out ECMASCRIPT_2016 "
                f"--js {collated_path} --js_output_file {dst_path} "
            )

    # in non-release mode, just copy the resulting source files from tmp_dir to dst_dir
    if not is_release:
        for tmp_path in os.listdir(tmp_dir):
            tmp_file_path = os.path.join(tmp_dir, tmp_path)
            dst_file_path = os.path.join(dst_dir, tmp_path)

            shutil.copy(tmp_file_path, dst_file_path)

        assert os.path.isfile(dst_app_js_path)

    # either way, clean up the tmp_dir
    shutil.rmtree(tmp_dir)

    return result

invoke_tsc()

# if we're in watch mode, monitor the src directory for changes (via inefficient, race-y
# polling...), dispatching an appropriate rebuild command depending on the extension of
# the modified file
def build_fingerprint():
    fingerprint = {}

    for iter_dir in [src_dir, resources_dir]:
        for filename in os.listdir(iter_dir):
            full_path = os.path.join(iter_dir, filename)

            if os.path.isdir(full_path):
                print(f"subdirectories within {iter_dir} are not yet supported")
                exit(1)

            try:
                mtime = os.stat(full_path).st_mtime_ns
                fingerprint[full_path] = mtime
            except FileNotFoundError:
                # temporary files may have been deleted since the os.listdir() call 
                None

    return fingerprint

if is_watch:
    print("initial build complete. watching for changes...")

    fingerprint = build_fingerprint()
    try:
        while True:
            time.sleep(0.5)

            # make a new fingerprint and diff it against the status quo
            new_fingerprint = build_fingerprint()
            if new_fingerprint == fingerprint:
                continue

            modified = []

            for key in new_fingerprint.keys():
                if not key in fingerprint or new_fingerprint[key] > fingerprint[key]:
                    modified.append(key)

            for key in fingerprint.keys():
                if not key in new_fingerprint:
                    modified.append(key)

            fingerprint = new_fingerprint

            # decide which operations to run depending on the modified file extensions...
            css_modified = []
            js_modified = []
            resources_modified = []

            for path in modified:
                if path.endswith(".scss"):
                    css_modified.append(path)
                elif any(path.endswith(suffix) for suffix in [".tsx", ".ts", ".jsx", ".js"]):
                    js_modified.append(path)
                elif os.path.normpath(os.path.dirname(path)).endswith("resources"):
                    resources_modified.append(path)
                elif path.endswith(".html"):
                    resources_modified.append(path)

            # ...and then run them
            if len(css_modified) > 0:
                print(f"files changed: {css_modified}. re-running sass...")
                if invoke_sass() != 0:
                    print("\a", end="")
                print("...sass complete")

            if len(resources_modified) > 0:
                print(f"files changed: {resources_modified}. copying resources to dst...")
                copy_resources()
                print("...copy complete")

            if len(js_modified) > 0:
                print(f"files changed: {js_modified}. re-running tsc...")
                if invoke_tsc() != 0:
                    print("\a", end="")
                print("...tsc complete")

    except KeyboardInterrupt:
        print("keyboard interrupt received. closing...", end="")
        exit(0)

