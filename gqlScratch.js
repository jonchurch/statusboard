require('dotenv').config()
const fetch = require('node-fetch')
const GITHUB_GRAPHQL_URL = 'https://api.github.com/graphql'

const headers = { Authorization: `bearer ${process.env.GITHUB_TOKEN}`, 'Content-Type': 'application/json' }
async function getRepoCountForOrg (org) {
  const query = `query($org: String!){
organization(login: $org) {
			repositories{
      totalCount
			}
    }
	}
	 `
  const body = JSON.stringify({ query, variables: { org } }, null, 2)
  const res = await fetch(GITHUB_GRAPHQL_URL, { headers, body, method: 'POST' })
  const { data, errors } = await res.json()
  if (errors) {
    throw errors
  }
  return data.organization.repositories.totalCount
}

async function getIssuesForOrg (org, repoCount) {
  const query = `query($org: String!, $repoCount: Int!) {
  organization(login: $org) {
     repositories(first: $repoCount) {
      nodes {
        name
        issues(states: OPEN, first: 100, orderBy: {field: CREATED_AT, direction: DESC}) {
          totalCount
          edges {
            cursor
            node {
              title
              updatedAt
              labels(first: 10) {
                nodes {
                  color
                  name
                  updatedAt
                }
              }
              number
            }
          }
        }
      }
    }
  }
}
  `

  const body = JSON.stringify({ query, variables: { org, repoCount } })
  const res = await fetch(GITHUB_GRAPHQL_URL, { headers, body, method: 'POST' })
  const { data, errors } = await res.json()
  if (errors) {
    throw errors
  }

  return data.organization.repositories.nodes
}

function repoIssueQueryFragment (orgName, repoName, cursor) {
  return `
	${repoName}: repository(owner: "${orgName}", name: "${repoName}") {
        name
        issues(states: OPEN, first: 100, after: "${cursor}", orderBy: {field: CREATED_AT, direction: DESC}) {
          totalCount
          edges {
            cursor
            node {
              title
              updatedAt
              labels(first: 10) {
                nodes {
                  color
                  name
                  updatedAt
                }
              }
              number
            }
          }
        }
      }
	`
}

async function makeRequestForRemaining (repos) {
  const queries = repos.map(({ name, cursor, owner }) => repoIssueQueryFragment(owner, name, cursor))

  const query = `query {
		${queries.join('\n')}
	}`
  const body = JSON.stringify({ query })
  const res = await fetch(GITHUB_GRAPHQL_URL, { headers, body, method: 'POST' })
  const { data, errors } = await res.json()
  if (errors) {
    throw errors
  }
  return data
}

function findReposWithMoreIssuesToGet (repos, owner) {
  return repos.filter(({ name, issues: { totalCount, edges } }) => {
    return totalCount - edges.length
  }).map(({ name, issues: { edges } }) => {
    const { cursor } = edges.slice().pop()
    return { name, cursor, owner }
  })
}
async function run (orgName) {
  try {
    const repoCount = await getRepoCountForOrg(orgName)
    // console.log({ repoCount })
    // once I know how many repos are in an org, I can more efficiently grab exactly how many repos I need on the first pass
    const repos = await getIssuesForOrg(orgName, repoCount)
    console.log(repos)
    // great, now I have repos and _some_ of their issues
    // For some repos, most prolly, this is all we need to do, we're done because we've retrieved all the issues
    const reposWithMoreIssuesToGet = findReposWithMoreIssuesToGet(repos, orgName)
    // console.log({ reposWithMoreIssuesToGet })
    const remaining = await makeRequestForRemaining(reposWithMoreIssuesToGet)
    // console.log(remaining)
		Object.keys(remaining).forEach(key => console.log(`${key}:${remaining[key].issues.edges.length}`))
		
  } catch (err) {
    if (err.length) {
      err.forEach(console.log)
    } else {
      console.log(err)
    }
  }
}

run('expressjs')
