// Fictional example content. Update this file to personalize the invitation.
// Dates and times are local to timeZone. Keep the no-JavaScript fallback in
// index.html in sync when publishing a personalized invitation.
export const wedding = {
  names: ['Alex', 'Taylor'],
  groomChinese: '示例新郎',
  brideChinese: '示例新娘',
  date: '2030-06-15',
  city: '示例城市',
  cityEnglish: 'Example City',
  timeZone: 'Asia/Shanghai',
  venue: '示例花园',
  venueTraditional: '示例花園',
  venueEnglish: 'Garden Venue',
  ceremonyTime: '16:30',
  hall: null,
  hallEnglish: null,
  streetAddress: null,
  streetAddressEnglish: null,
  // Add a local recording you have permission to use; playback is opt-in.
  music: { src: '', title: '', credit: '', autoplay: false },
  // Original geometric placeholders are included; no personal photographs.
  // Optional photo credits: location and photographer (both plain text).
  photos: {
    hero: { src: '/assets/demo/arch.svg', alt: '暖色拱门与圆形组成的抽象插画 / Abstract arch and sun', position: 'center' },
    detail: { src: '/assets/demo/garden.svg', alt: '圆形与线条组成的花园插画 / Geometric garden', position: 'center' },
    memory: { src: '/assets/demo/together.svg', alt: '两个相连圆环的抽象插画 / Two connected circles', position: 'center' }
  },
  introduction: '良辰有约，邀你同庆。',
  closing: '为爱相聚，\n期待与你相见。'
};
