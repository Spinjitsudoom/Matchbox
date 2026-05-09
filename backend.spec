# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_all

datas = []
binaries = []
hiddenimports = []

for pkg in ('faster_whisper', 'ctranslate2', 'uvicorn', 'fastapi', 'anyio', 'starlette'):
    tmp = collect_all(pkg)
    datas += tmp[0]; binaries += tmp[1]; hiddenimports += tmp[2]

hiddenimports += [
    'api',
    'tmdb_engine',
    'faster_whisper.assets',
    'ctranslate2.converters.eole_ct2',
    'uvicorn.__main__',
    'uvicorn.lifespan',
    'uvicorn.lifespan.off',
    'uvicorn.lifespan.on',
    'uvicorn.loops',
    'uvicorn.loops.asyncio',
    'uvicorn.loops.auto',
    'uvicorn.protocols.http.auto',
    'uvicorn.protocols.websockets.auto',
    'uvicorn.workers',
    'fastapi.__main__',
    'fastapi.middleware.gzip',
    'fastapi.middleware.httpsredirect',
    'fastapi.middleware.trustedhost',
    'fastapi.middleware.wsgi',
    'fastapi.templating',
    'fastapi.testclient',
    'anyio._backends',
    'anyio._backends._asyncio',
    'anyio._backends._trio',
    'anyio.functools',
    'anyio.pytest_plugin',
    'anyio.streams.buffered',
    'anyio.streams.file',
    'anyio.streams.text',
    'anyio.to_interpreter',
    'anyio.to_process',
    'starlette.authentication',
    'starlette.config',
    'starlette.endpoints',
    'starlette.middleware.authentication',
    'starlette.schemas',
    'Levenshtein',
]

excludes = [
    'torch', 'torchvision', 'torchaudio',
    'nvidia', 'triton', 'tiktoken',
    'PIL', 'pillow', 'numba', 'llvmlite',
]

a = Analysis(
    ['backend_main.py'],
    pathex=[],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=excludes,
    noarchive=False,
    optimize=0,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='backend_main',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='backend_main',
)
