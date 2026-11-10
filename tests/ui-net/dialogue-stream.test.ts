import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDialogue } from '../../app/src/ui/dialogue';
import { formatAction } from '../../app/src/ui/text';
import type { NpcSpec } from '../../app/src/world/spec';

// A very small DOM: just enough for the dialogue panel to build, stream into and read back.
class FakeEl {
  className = '';
  hidden = false;
  disabled = false;
  type = '';
  value = '';
  children: FakeEl[] = [];
  parent: FakeEl | null = null;
  private own = '';
  attrs = new Map<string, string>();
  constructor(public tag: string) {}
  get classList(): { add(c: string): void; remove(c: string): void; contains(c: string): boolean } {
    const set = (): Set<string> => new Set(this.className.split(/\s+/).filter(Boolean));
    return {
      add: (c) => { this.className = [...set().add(c)].join(' '); },
      remove: (c) => { const s = set(); s.delete(c); this.className = [...s].join(' '); },
      contains: (c) => set().has(c),
    };
  }
  get textContent(): string { return this.own + this.children.map((c) => c.textContent).join(''); }
  set textContent(v: string) { this.own = v; this.children = []; }
  get childElementCount(): number { return this.children.filter((c) => c.tag !== '#text').length; }
  get isConnected(): boolean { return true; }
  append(...nodes: FakeEl[]): void { for (const n of nodes) { n.parent = this; this.children.push(n); } }
  replaceChildren(...nodes: FakeEl[]): void { this.own = ''; this.children = []; this.append(...nodes); }
  remove(): void { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); }
  setAttribute(k: string, v: string): void { this.attrs.set(k, v); }
  addEventListener(): void {}
  removeEventListener(): void {}
  focus(): void {}
  find(cls: string): FakeEl[] {
    const out: FakeEl[] = [];
    for (const c of this.children) {
      if (c.className.split(/\s+/).includes(cls)) out.push(c);
      out.push(...c.find(cls));
    }
    return out;
  }
}

const g = globalThis as Record<string, unknown>;
const npc = { id: 'nell', name: 'Nell Harker', role: 'barkeep' } as unknown as NpcSpec;

function open() {
  const layer = new FakeEl('div');
  const root = new FakeEl('div');
  const view = createDialogue(layer as unknown as HTMLElement, root as unknown as HTMLElement);
  const handle = view.open(npc, () => undefined, () => undefined);
  return { layer, handle };
}

beforeEach(() => {
  g['document'] = {
    createElement: (t: string) => new FakeEl(t),
    createTextNode: (s: string) => { const n = new FakeEl('#text'); n.textContent = s; return n; },
    activeElement: null,
  };
  g['window'] = { setTimeout: () => 0 };
  g['HTMLElement'] = FakeEl;
});
afterEach(() => {
  delete g['document'];
  delete g['window'];
  delete g['HTMLElement'];
});

describe('dialogue stream', () => {
  it('replaces the line with whatever it is given, so a fallback never appends to a partial', () => {
    const { layer, handle } = open();
    handle.stream('*tips hat slow, keeps one eye on the road');
    handle.stream("Not now, friend. Come back when the street's quieter.");
    const lines = layer.find('tf-line-npc');
    expect(lines).toHaveLength(1);
    const text = lines[0]?.find('tf-line-text')[0];
    expect(text?.textContent).toBe("Not now, friend. Come back when the street's quieter.");
    expect(lines[0]?.find('tf-line-action').length).toBe(0);
    handle.done();
    expect(layer.find('tf-line-npc')[0]?.find('tf-line-text')[0]?.textContent).toBe("Not now, friend. Come back when the street's quieter.");
  });

  it('shows the action on its own line, without asterisks, above the speech', () => {
    const { layer, handle } = open();
    handle.stream('*leans on the plaza rail, grinning* Well, look at you...');
    const box = layer.find('tf-line-npc')[0];
    expect(box?.find('tf-line-action').map((a) => a.textContent)).toEqual(['Nell leans on the plaza rail, grinning.']);
    expect(box?.find('tf-line-text')[0]?.textContent).toBe('Well, look at you...');
    const kids = box?.children.map((c) => c.className) ?? [];
    expect(kids.indexOf('tf-line-actions')).toBeLessThan(kids.indexOf('tf-line-text'));
    // a shorter replacement is not merged with the old text
    handle.stream('Hm.');
    expect(box?.find('tf-line-text')[0]?.textContent).toBe('Hm.');
    expect(box?.find('tf-line-action').length).toBe(0);
  });
});

describe('formatAction', () => {
  it('prefixes the first name and ends with one full stop', () => {
    expect(formatAction('Nell Harker', 'leans on the plaza rail, grinning')).toBe('Nell leans on the plaza rail, grinning.');
    expect(formatAction('Nell', 'sighs...')).toBe('Nell sighs.');
    expect(formatAction('Nell', ' ')).toBe('');
  });
});
