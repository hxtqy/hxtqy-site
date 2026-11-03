/**
 * 站点级渐进增强。全部可失败：任一功能出错都不影响阅读。
 */

function setupNav(): void {
  const nav = document.querySelector<HTMLElement>('[data-nav]');
  if (!nav) return;

  const update = () => {
    nav.dataset.solid = window.scrollY > 8 ? 'true' : 'false';
  };

  update();
  window.addEventListener('scroll', update, { passive: true });
}

function setupTheme(): void {
  const button = document.querySelector<HTMLButtonElement>('[data-theme-toggle]');
  if (!button) return;

  button.addEventListener('click', () => {
    const root = document.documentElement;
    const next = root.dataset.theme === 'light' ? 'dark' : 'light';
    root.dataset.theme = next;
    try {
      localStorage.setItem('hxtqy-theme', next);
    } catch {
      /* 隐私模式下忽略 */
    }
  });
}

/** 给每个 pre > code 加复制按钮，并在上方生成文件名条 */
function setupCodeCopy(): void {
  const blocks = Array.from(document.querySelectorAll<HTMLPreElement>('.prose pre'));

  blocks.forEach((pre) => {
    const code = pre.querySelector('code');
    if (!code) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'code-block';
    pre.parentNode?.insertBefore(wrapper, pre);
    wrapper.appendChild(pre);

    const bar = document.createElement('div');
    bar.className = 'code-block__bar';

    // Shiki 会把语言写成 class="language-ts"
    const langClass = Array.from(code.classList).find((name) => name.startsWith('language-'));
    const label = document.createElement('span');
    label.textContent = langClass ? langClass.replace('language-', '') : 'code';
    bar.appendChild(label);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'copy-btn';
    button.textContent = '复制';
    button.setAttribute('aria-label', '复制代码');
    bar.appendChild(button);

    wrapper.insertBefore(bar, pre);

    button.addEventListener('click', async () => {
      const text = code.textContent ?? '';
      try {
        await navigator.clipboard.writeText(text);
        button.textContent = '已复制';
        button.dataset.copied = 'true';
        window.setTimeout(() => {
          button.textContent = '复制';
          button.dataset.copied = 'false';
        }, 1400);
      } catch {
        button.textContent = '复制失败';
        window.setTimeout(() => {
          button.textContent = '复制';
        }, 1800);
      }
    });
  });
}

/** 目录高亮：滚动到哪个标题就点亮哪一条 */
function setupToc(): void {
  const toc = document.querySelector<HTMLElement>('[data-toc]');
  if (!toc) return;

  const links = Array.from(toc.querySelectorAll<HTMLAnchorElement>('a[href^="#"]'));
  if (links.length === 0) return;

  const targets = links
    .map((link) => {
      const id = decodeURIComponent(link.getAttribute('href')!.slice(1));
      const heading = document.getElementById(id);
      return heading ? { link, heading } : null;
    })
    .filter((entry): entry is { link: HTMLAnchorElement; heading: HTMLElement } => entry !== null);

  if (targets.length === 0) return;

  let activeLink: HTMLAnchorElement | null = null;

  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);

      const first = visible[0];
      const entry =
        targets.find((item) => item.heading === first?.target) ??
        targets.find((item) => item.heading.getBoundingClientRect().top > 120) ??
        targets[targets.length - 1];

      if (!entry || entry.link === activeLink) return;
      activeLink?.removeAttribute('data-active');
      activeLink = entry.link;
      activeLink.setAttribute('data-active', 'true');
    },
    { rootMargin: '-96px 0px -70% 0px', threshold: [0, 1] }
  );

  targets.forEach((entry) => observer.observe(entry.heading));
}

/** 阅读进度条（文章页） */
function setupProgress(): void {
  const bar = document.querySelector<HTMLElement>('[data-progress]');
  if (!bar) return;

  let raf = 0;
  const update = () => {
    raf = 0;
    const doc = document.documentElement;
    const max = doc.scrollHeight - window.innerHeight;
    const value = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
    bar.style.setProperty('--progress', value.toFixed(4));
  };

  const onScroll = () => {
    if (raf) return;
    raf = window.requestAnimationFrame(update);
  };

  update();
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
}

/** 首页索引刻度的当前项高亮 */
function setupSectionTicks(): void {
  const ticks = document.querySelectorAll<HTMLElement>('[data-tick]');
  if (ticks.length === 0) return;

  const sections = Array.from(ticks)
    .map((tick) => {
      const id = tick.dataset.tick;
      const section = id ? document.getElementById(id) : null;
      return section ? { tick, section } : null;
    })
    .filter((entry): entry is { tick: HTMLElement; section: HTMLElement } => entry !== null);

  if (sections.length === 0) return;

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        const match = sections.find((item) => item.section === entry.target);
        if (!match) return;
        if (entry.isIntersecting) {
          ticks.forEach((tick) => tick.removeAttribute('data-active'));
          match.tick.dataset.active = 'true';
        }
      });
    },
    { rootMargin: '-45% 0px -45% 0px' }
  );

  sections.forEach((entry) => observer.observe(entry.section));
}

function boot(): void {
  setupNav();
  setupTheme();
  setupCodeCopy();
  setupToc();
  setupProgress();
  setupSectionTicks();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
