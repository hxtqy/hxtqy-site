import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';

const links = [
  { label: 'GitHub', href: 'https://github.com/hxtqy' },
];

const sections = [
  {
    title: '关于',
    body: '这里将放个人介绍、技能栈与经历。',
  },
  {
    title: '项目',
    body: '这里将放作品集、开源项目与实验。',
  },
  {
    title: '联系',
    body: '这里将放邮箱、社交账号与留言方式。',
  },
];

export default function Hero() {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      if (reduceMotion) {
        gsap.set('.reveal', { opacity: 1, y: 0 });
        return;
      }

      gsap.from('.reveal', {
        y: 36,
        opacity: 0,
        duration: 0.9,
        ease: 'power3.out',
        stagger: 0.09,
      });

      gsap.from('.card', {
        y: 28,
        opacity: 0,
        duration: 0.8,
        ease: 'power2.out',
        stagger: 0.12,
        delay: 0.45,
      });

      gsap.to('.orb-a', {
        y: 26,
        duration: 7,
        repeat: -1,
        yoyo: true,
        ease: 'sine.inOut',
      });

      gsap.to('.orb-b', {
        y: -32,
        x: 18,
        duration: 9,
        repeat: -1,
        yoyo: true,
        ease: 'sine.inOut',
      });
    }, rootRef);

    return () => ctx.revert();
  }, []);

  return (
    <div ref={rootRef} className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-0 grid-noise" aria-hidden="true" />
      <div
        className="orb-a pointer-events-none absolute -left-24 top-24 h-72 w-72 rounded-full bg-[#8b7bff]/25 blur-[100px]"
        aria-hidden="true"
      />
      <div
        className="orb-b pointer-events-none absolute -right-20 top-1/3 h-80 w-80 rounded-full bg-[#4fd1c5]/20 blur-[110px]"
        aria-hidden="true"
      />

      <header className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6">
        <a href="/" className="reveal flex items-center gap-2 text-sm font-medium tracking-wide">
          <span className="inline-block h-2 w-2 rounded-full bg-gradient-to-r from-[#8b7bff] to-[#4fd1c5]" />
          hxtqy
        </a>
        <nav className="reveal flex items-center gap-6 text-sm text-zinc-400">
          <a className="transition-colors hover:text-white" href="#about">
            关于
          </a>
          <a className="transition-colors hover:text-white" href="#projects">
            项目
          </a>
          <a className="transition-colors hover:text-white" href="#contact">
            联系
          </a>
        </nav>
      </header>

      <main className="relative z-10 mx-auto flex w-full max-w-6xl flex-col px-6">
        <section className="flex min-h-[62vh] flex-col justify-center py-20">
          <p className="reveal mb-6 text-xs uppercase tracking-[0.35em] text-zinc-500">
            Personal site · 2026
          </p>
          <h1 className="reveal text-balance text-6xl font-semibold leading-none tracking-tight sm:text-8xl">
            hxtqy
          </h1>
          <p className="reveal mt-8 max-w-xl text-balance text-lg leading-relaxed text-zinc-400">
            一个正在搭建中的个人网站。用 Astro、React、Tailwind CSS 与 GSAP 构建，
            后续会陆续放上介绍、作品与联系方式。
          </p>
          <div className="reveal mt-10 flex flex-wrap items-center gap-4">
            <a
              className="rounded-full bg-white px-6 py-3 text-sm font-medium text-black transition-transform hover:-translate-y-0.5"
              href="#projects"
            >
              看看项目
            </a>
            {links.map((link) => (
              <a
                key={link.href}
                className="rounded-full border border-white/15 px-6 py-3 text-sm text-zinc-300 transition-colors hover:border-white/35 hover:text-white"
                href={link.href}
                target="_blank"
                rel="noreferrer"
              >
                {link.label}
              </a>
            ))}
          </div>
        </section>

        <section id="about" className="grid gap-4 pb-24 sm:grid-cols-3">
          {sections.map((section) => (
            <article
              key={section.title}
              id={section.title === '项目' ? 'projects' : section.title === '联系' ? 'contact' : undefined}
              className="card rounded-2xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur-sm"
            >
              <h2 className="reveal text-sm font-medium tracking-wide text-zinc-200">
                {section.title}
              </h2>
              <p className="reveal mt-3 text-sm leading-relaxed text-zinc-500">{section.body}</p>
            </article>
          ))}
        </section>
      </main>

      <footer className="relative z-10 mx-auto w-full max-w-6xl px-6 pb-10">
        <div className="reveal border-t border-white/10 pt-6 text-xs text-zinc-600">
          © {new Date().getFullYear()} hxtqy · Built with Astro
        </div>
      </footer>
    </div>
  );
}
