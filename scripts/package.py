from pathlib import Path
import hashlib
import json
import re
import shutil
import subprocess
import zipfile

root = Path(__file__).resolve().parent.parent
manifest = json.loads((root / 'manifest.json').read_text())
version = manifest['version']
assert json.loads((root / 'package.json').read_text())['version'] == version
assert manifest['manifest_version'] == 3
assert manifest['name'] == '文章透镜'
assert set(manifest['permissions']) == {'activeTab', 'scripting', 'storage', 'sidePanel'}
assert manifest['host_permissions'] == ['https://api.typesafe.ai/*']
assert 'content_scripts' not in manifest and 'web_accessible_resources' not in manifest
runtime = ['manifest.json', 'background.js', 'extractor.js', 'panel.html', 'panel.js', 'panel.css', 'LICENSE', 'README.md', 'README.en.md', 'THIRD_PARTY_NOTICES.md']
for directory in ['lib', 'ui', 'icons', 'vendor', 'docs']:
    runtime += [p.relative_to(root).as_posix() for p in (root / directory).rglob('*') if p.is_file()]
refs = [manifest['background']['service_worker'], manifest['side_panel']['default_path']] + list(manifest['icons'].values()) + list(manifest['action']['default_icon'].values())
assert all(r in runtime for r in refs)
node = shutil.which('node')
assert node, 'Node.js is required for packaging checks'
for name in runtime:
    file = root / name
    assert file.is_file() and not file.is_symlink()
    if file.suffix == '.js':
        subprocess.run([node, '--check', str(file)], check=True, capture_output=True)
        for imported in re.findall(r'(?:from\s*|import\s*)["\'](\.[^"\']+)["\']', file.read_text()):
            target = (file.parent / imported).resolve()
            assert target.is_relative_to(root) and target.is_file()
    if file.suffix == '.html':
        for resource in re.findall(r'(?:src|href)=["\']([^"\']+)["\']', file.read_text()):
            if ':' not in resource and not resource.startswith('#'):
                assert (file.parent / resource).is_file()
assert hashlib.sha256((root / 'vendor/Readability.js').read_bytes()).hexdigest() == '61521a78d29e60def9623a14ebcc5a54aff88c61fd11326d7c016478a4f23047'

out = root / 'dist'
out.mkdir(exist_ok=True)

def package(names, filename):
    assert len(names) == len(set(names))
    target = out / filename
    with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as archive:
        for name in sorted(names):
            assert not (root / name).is_symlink()
            archive.write(root / name, name)
    with zipfile.ZipFile(target) as archive:
        assert 'manifest.json' in archive.namelist()
        assert archive.testzip() is None
        for name in archive.namelist():
            assert '..' not in Path(name).parts and not Path(name).is_absolute()
            assert archive.read(name) == (root / name).read_bytes()
    digest = hashlib.sha256(target.read_bytes()).hexdigest()
    (out / (filename + '.sha256')).write_text(digest + '  ' + filename + '\n')
    print(json.dumps({'file': filename, 'bytes': target.stat().st_size, 'sha256': digest}, ensure_ascii=False))

package(runtime, f'articles-lens-v{version}.zip')
