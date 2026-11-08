// Progressive enhancement: the information is readable before JavaScript runs.
const book = document.querySelector('[data-invitation-book]');
const toggle = document.querySelector('[data-book-toggle]');
const cover = document.querySelector('[data-book-cover]');
const page = document.querySelector('[data-book-page]');
const chinese = document.querySelector('[data-book-chinese]');
const leafToggle = document.querySelector('[data-book-language]');
const narrow = matchMedia('(max-width: 700px)');
if (book && toggle && cover && page && chinese && leafToggle) {
  let open = true;
  let leaf = 'gold';
  const show = (element, visible) => {
    element.inert = !visible;
    element.setAttribute('aria-hidden', String(!visible));
  };
  const render = (moveFocus = false) => {
    const chineseActive = narrow.matches && leaf === 'chinese';
    book.dataset.open = String(open);
    book.dataset.leaf = leaf;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.querySelector('[data-book-label]').textContent = open ? '合上请帖' : '打开我们的请帖';
    leafToggle.hidden = !open || !narrow.matches;
    leafToggle.textContent = chineseActive ? '查看英文请帖' : '查看中文请帖';
    leafToggle.setAttribute('aria-pressed', String(chineseActive));
    show(page, open && !chineseActive);
    show(chinese, open && (!narrow.matches || chineseActive));
    // Focus follows the visible page; controls remain reachable after each turn.
    if (moveFocus) (open ? (chineseActive ? chinese : page) : toggle).focus({ preventScroll: true });
    cover.tabIndex = open ? -1 : 0;
    show(cover, !open);
  };
  const setOpen = next => {
    open = next;
    if (!open) leaf = 'gold';
    render(true);
  };
  toggle.hidden = false;
  book.parentElement.classList.add('is-enhanced');
  book.dataset.ready = '';
  open = false;
  render();
  toggle.addEventListener('click', () => setOpen(!open));
  cover.addEventListener('click', () => setOpen(true));
  leafToggle.addEventListener('click', () => {
    leaf = leaf === 'gold' ? 'chinese' : 'gold';
    render(true);
  });
  narrow.addEventListener('change', () => {
    const focus = document.activeElement;
    const hadFocus = page.contains(focus) || chinese.contains(focus) || focus === leafToggle;
    if (!narrow.matches) leaf = 'gold';
    render(open && hadFocus);
  });
  document.querySelector('.book-section').addEventListener('keydown', event => {
    if (event.key === 'Escape' && open) setOpen(false);
  });
}
