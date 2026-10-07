// Edit freely. Posts can carry up to MAX_GENRES of these.
const GENRES = [
  // Fiction
  'Adventure', 'Gothic', 'Fantasy', 'Dark Fantasy', 'Urban Fantasy', 'Sci-Fi', 'Cyberpunk', 'Steampunk',
  'Dystopian', 'Post-Apocalyptic', 'Horror', 'Supernatural', 'Paranormal', 'Mystery', 'Crime', 'Thriller',
  'Romance', 'Historical Fiction', 'Literary Fiction', 'Magical Realism', 'Fairy Tale', 'Mythology',
  'Western', 'Action', 'Drama', 'Humor', 'Satire', 'Slice of Life', 'Coming of Age', 'Young Adult',
  'Fan Fiction', 'Flash Fiction', 'Short Story', 'Novel Excerpt', 'Experimental',
  // Poetry & song
  'Poetry', 'Free Verse', 'Haiku', 'Spoken Word', 'Song Lyrics',
  // Non-fiction & personal
  'Essay', 'Memoir', 'Personal Reflection', 'Journal', 'Letter', 'Opinion', 'Review', 'Non-fiction',
  // Other
  'Screenplay', 'Worldbuilding', 'Prompt Response', 'Other',
];
const MAX_GENRES = 3;
module.exports = { GENRES, MAX_GENRES };
