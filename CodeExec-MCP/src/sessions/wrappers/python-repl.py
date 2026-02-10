"""
CodeExec Python REPL wrapper.

Reads code blocks delimited by boundary markers from stdin,
executes them via compile()+exec()/eval(), and prints a done
sentinel to stdout after each block completes.

Protocol:
  Parent writes lines of code, then a boundary line:
    __CODEXEC_BOUNDARY_<uuid8>__
  Wrapper executes the code, then prints:
    __CODEXEC_DONE_<uuid8>__
"""
import sys
import traceback


def main():
    while True:
        lines = []
        boundary = None

        for line in sys.stdin:
            line = line.rstrip('\n')
            if line.startswith('__CODEXEC_BOUNDARY_') and line.endswith('__'):
                boundary = line.replace('BOUNDARY', 'DONE')
                break
            lines.append(line)

        if boundary is None:
            # stdin closed — exit cleanly
            break

        code = '\n'.join(lines)
        if not code.strip():
            print(boundary, flush=True)
            continue

        try:
            # Use module globals for exec/eval so defined names persist
            # and recursive functions can reference themselves
            g = globals()
            # Try eval first for expressions (e.g. "2+2" → prints "4")
            try:
                result = eval(compile(code, '<session>', 'eval'), g)
                if result is not None:
                    print(repr(result))
            except SyntaxError:
                # Not an expression — execute as statements
                exec(compile(code, '<session>', 'exec'), g)
        except Exception:
            traceback.print_exc()
        finally:
            sys.stdout.flush()
            sys.stderr.flush()
            print(boundary, flush=True)


if __name__ == '__main__':
    main()
