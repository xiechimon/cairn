import re

FENCE = re.compile(r'^ {0,3}(`{3,}|~{3,})(.*)$')
CODE_OR_COMMENT = re.compile(r'(?P<ticks>`+)(?!`).*?(?<!`)(?P=ticks)(?!`)|<!--')
TASK = re.compile(
    r'^[ \t]*(?:>[ \t]?)*[ \t]*(?:[-*+]|\d+[.)])[ \t]+\[([ xX])\][ \t]*(.*)$',
    re.M)


def visible_markdown(body, blank_fences=True):
    out = []
    fence = None
    inside_comment = False
    for line in body.split('\n'):
        marker = FENCE.match(line)
        if fence is not None:
            if (marker and marker.group(1)[0] == fence[0]
                    and len(marker.group(1)) >= len(fence)
                    and not marker.group(2).strip()):
                fence = None
            out.append(' ' * len(line) if blank_fences else line)
            continue
        if marker and not inside_comment:
            fence = marker.group(1)
            out.append(' ' * len(line) if blank_fences else line)
            continue
        visible = []
        cursor = 0
        while cursor < len(line):
            if inside_comment:
                end = line.find('-->', cursor)
                if end == -1:
                    visible.append(' ' * (len(line) - cursor))
                    break
                visible.append(' ' * (end + 3 - cursor))
                cursor = end + 3
                inside_comment = False
            else:
                token = CODE_OR_COMMENT.search(line, cursor)
                if token is None:
                    visible.append(line[cursor:])
                    break
                start, end = token.span()
                close = line.find('-->', start + 2)
                if (token.group('ticks') is not None
                        or not (re.fullmatch(r' {0,3}', line[:start])
                                or close != -1)):
                    visible.append(line[cursor:end])
                    cursor = end
                    continue
                if close != -1:
                    visible.append(line[cursor:start] + ' ' * (close + 3 - start))
                    cursor = close + 3
                    continue
                visible.append(line[cursor:start] + ' ' * (len(line) - start))
                inside_comment = True
                break
        out.append(''.join(visible))
    return '\n'.join(out)
