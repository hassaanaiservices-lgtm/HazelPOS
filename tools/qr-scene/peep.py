"""Assemble Open Peeps (CC0, Pablo Stanley) parts into SVG without Node.
Reads the DiceBear package source as text only; nothing from it is executed."""
import re, pathlib

LIB = pathlib.Path(__file__).parent / "open-peeps" / "lib"

def _fill(tpl, colors):
    for k, v in colors.items():
        tpl = tpl.replace("${escape.xml(`${colors.%s}`)}" % k, v)
    assert "${" not in tpl, tpl[tpl.index("${"):][:80]
    return tpl

def part(group, name, colors):
    s = (LIB / "components" / f"{group}.js").read_text()
    m = re.search(r"\n\s*'?%s'?:\s*\(components, colors\)\s*=>\s*`(.*?)`,?\n" % re.escape(name), s, re.S)
    if not m:
        raise KeyError(f"{group}.{name}")
    return _fill(m.group(1), colors)

def base(colors):
    s = (LIB / "index.js").read_text()
    body = s[s.index("body: `") + 7:]
    body = body[:body.index("`,\n")]
    first = body[:body.index('<g transform="matrix')]
    return _fill(first.replace("${escape.xml(`${colors.skin}`)}", colors["skin"])
                      .replace("${escape.xml(`${colors.clothing}`)}", colors["clothing"]), colors)

# offsets taken from the package's own template
OFF = {"head": "matrix(.99789 0 0 1 156 62)", "face": "translate(315 248)",
       "facialHair": "translate(279 400)", "accessories": "translate(203 303)"}

def peep(colors, head, faces, facial_hair=None, accessories=None, face_class="pf"):
    """faces: list of names; each face is its own <g> so it can be switched on and off."""
    out = [base(colors)]
    out.append(f'<g transform="{OFF["head"]}">{part("head", head, colors)}</g>')
    for i, f in enumerate(faces):
        out.append(f'<g class="{face_class} {face_class}--{f}" transform="{OFF["face"]}">{part("face", f, colors)}</g>')
    if facial_hair:
        out.append(f'<g transform="{OFF["facialHair"]}">{part("facialHair", facial_hair, colors)}</g>')
    if accessories:
        out.append(f'<g transform="{OFF["accessories"]}">{part("accessories", accessories, colors)}</g>')
    return "".join(out)
