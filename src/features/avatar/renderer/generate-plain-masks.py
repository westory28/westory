"""Offline atlas masks for the bundled, fully clothed avatar GLBs.

Run with Python + Pillow + NumPy. This does not modify the original model,
UVs, skinning, or appearance masks. It is not a runtime dependency.
"""
from pathlib import Path
import json
import struct
import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[4]
MODELS = ROOT / 'public/avatar/v1/models'
SIZE = 2048


def read_glb(path):
    data = path.read_bytes()
    n = struct.unpack_from('<I', data, 12)[0]
    return json.loads(data[20:20+n]), data[28+n:]


def accessor(doc, data, index):
    a = doc['accessors'][index]
    view = doc['bufferViews'][a['bufferView']]
    size = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[a['type']]
    dtype = np.dtype({5121:'<u1',5123:'<u2',5125:'<u4',5126:'<f4'}[a['componentType']])
    return np.ndarray((a['count'],size),dtype=dtype,buffer=data,
        offset=view.get('byteOffset',0)+a.get('byteOffset',0),
        strides=(view.get('byteStride',dtype.itemsize*size),dtype.itemsize)).copy()


def raster(uv, triangles, positions):
    coords = uv * SIZE - .5
    atlas = np.full((SIZE,SIZE,3),np.nan,dtype=np.float32)
    for ids in triangles:
        points = coords[ids]
        x0,y0 = np.floor(points.min(0)).astype(int)
        x1,y1 = np.ceil(points.max(0)).astype(int)
        x0,y0,x1,y1 = max(0,x0),max(0,y0),min(SIZE-1,x1),min(SIZE-1,y1)
        if x1<x0 or y1<y0: continue
        (ax,ay),(bx,by),(cx,cy) = points
        determinant = (by-cy)*(ax-cx)+(cx-bx)*(ay-cy)
        if abs(determinant)<1e-9: continue
        px,py = np.meshgrid(np.arange(x0,x1+1),np.arange(y0,y1+1))
        wa = ((by-cy)*(px-cx)+(cx-bx)*(py-cy))/determinant
        wb = ((cy-ay)*(px-cx)+(ax-cx)*(py-cy))/determinant
        wc = 1-wa-wb
        inside = (wa>=-1e-5)&(wb>=-1e-5)&(wc>=-1e-5)
        values = wa[...,None]*positions[ids[0]]+wb[...,None]*positions[ids[1]]+wc[...,None]*positions[ids[2]]
        atlas[y0:y1+1,x0:x1+1][inside] = values[inside]
    return atlas


def padding(candidate, coverage):
    mask = np.asarray(Image.fromarray(np.uint8(candidate&coverage)*255).filter(ImageFilter.MaxFilter(5))).copy()
    mask[coverage&~candidate] = 0
    return mask


for character in ['girl','boy']:
    doc,data = read_glb(MODELS/f'{character}-base.glb')
    primitive = doc['meshes'][0]['primitives'][0]
    positions = accessor(doc,data,primitive['attributes']['POSITION'])
    uv = accessor(doc,data,primitive['attributes']['TEXCOORD_0'])
    triangles = accessor(doc,data,primitive['indices']).reshape(-1,3)
    scale = .98/(positions[:,1].max()-positions[:,1].min())
    positions[:,0] *= scale
    positions[:,2] *= scale
    positions[:,1] = (positions[:,1]-positions[:,1].min())*scale-.49
    atlas = raster(uv,triangles,positions)
    side,y,front = [atlas[:,:,i] for i in range(3)]
    coverage = np.isfinite(y)
    clothes = np.asarray(Image.open(MODELS/f'{character}-base-color-mask.png').convert('RGBA'))
    appearance = np.asarray(Image.open(MODELS/f'{character}-base-appearance-mask.png').convert('RGBA'))
    skin_or_hair = (appearance[:,:,0]>32)|(appearance[:,:,1]>32)
    hands = (np.abs(side)>(.205 if character=='girl' else .16))&(y<(-.05 if character=='girl' else -.07))
    neck = (np.abs(side)<.065)&(y>.13)&(front>-.035)&(front<.115)
    top = (clothes[:,:,0]>16)|((y>-.14)&(y<.175)&~hands&~neck&~skin_or_hair&(clothes[:,:,1]<16))
    low = -.22 if character=='girl' else -.43
    high = -.025 if character=='girl' else -.08
    bottom = (clothes[:,:,1]>16)|((y>low)&(y<high)&~hands&~skin_or_hair&(clothes[:,:,0]<16))
    shoes = y<(-.37 if character=='girl' else -.40)
    channels = [padding(mask,coverage) for mask in [top,bottom,shoes]]
    output = np.stack([*channels,np.full((SIZE,SIZE),255,dtype=np.uint8)],axis=-1)
    target = MODELS/f'{character}-base-plain-mask.png'
    Image.fromarray(output).save(target,optimize=True)
    print(character, target.stat().st_size, [int(np.count_nonzero(c)) for c in channels])
