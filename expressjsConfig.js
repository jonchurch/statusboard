
const path = require('path');

module.exports = {
  db: path.join(__dirname, 'tmp', 'data.db'),
  baseUrl: '/statusboard',
  outputDirectory: path.join(__dirname, 'tmp'),
  github: {
    token: process.env.GITHUB_TOKEN,
  },

  title: 'StatusBoard Test',
  description: 'A test for StatusBoard',

  orgs: ['expressjs', 'jshttp', 'pillarjs'],

  projects: [
  ],

  people: [
    {
      name: 'Wes Todd',
      email: 'wes@wesleytodd.com',
      website: 'http://www.github.com/wesleytodd',
      npmUsername: 'wesleytodd',
      githubUsername: 'wesleytodd',
      twitterUsername: 'wesleytodd',
    },
    {
      name: 'Jon Church',
      website: 'http://www.github.com/jonchurch',
      npmUsername: 'jonchurch',
      githubUsername: 'jonchurch',
      twitterUsername: 'jonchurch',
    },
  ],
};
