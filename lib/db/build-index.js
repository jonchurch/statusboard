'use strict'
const github = require('../github')
const files = require('../files')
const npm = require('../npm')
const { Project } = require('../project')

async function getAllProjectsForOrgs (octokit, orgs) {
  const results = []
  try {
    for (const org of orgs) {
      for await (const repo of github.getOrgRepos(octokit, org.name)) {
        const proj = new Project({
          repoOwner: repo.owner,
          repoName: repo.name
        })
        results.push(proj)
      }
    }
    return results
  } catch (e) {
    console.log(e)
  }
}

async function selectProjectsToUpdate (db, projects, maxToSelect = 15) {
  // check the leveldb to see which projects:
  // * Do not exist yet
  // * were updated the longest time ago
  // And then from that list, pick X projects to update

  // I guess I can query by key to see if any at all exist?
  const updatedInfo = await Promise.all(
    projects.map((project) => db.get(`${project.repoOwner}:${project.repoName}:lastUpdated`).then(value => [project, value])
      .catch(err => {
        if (err.type === 'NotFoundError') {
          // this key is not found, the project likely hasn't been indexed
          // errors are actually high priority here, we want to keep this info
          return [project, 0]
        }
      })))

  // sort projects by ascending time last updated
  // grab 15 projects updated the longest time ago
  console.log(updatedInfo.sort((a, b) => a[1] - b[1]).slice(0, maxToSelect).map(([proj, updated]) => `${proj.repo} ${updated}`))
  return updatedInfo.sort((a, b) => a[1] - b[1]).slice(0, maxToSelect).map(([proj]) => proj)
}

module.exports = async function buildIndex (config, db) {
  const octokit = await github(config.github)
  // lets get all projects first
  let projects = await getAllProjectsForOrgs(octokit, config.orgs)
  // @TODO test this! I'm concerned with org levels not individual projects atm
  // Ideally config.projects is perfectly mergeable with our org projects
  // (should also de-dupe just in case)
  //
  projects = projects.concat(config.projects)

  const needsUpdate = await selectProjectsToUpdate(db, projects, 50)

  // Loop projects
  for await (let evt of iterateProjects(needsUpdate, config)) {
    const { type, project, detail } = evt
    let key = `${project.repoOwner}:${project.repoName}:${type}`
    switch (type) {
      case 'ISSUE':
        key += `:${detail.number}`
        break
      case 'ACTIVITY':
        key += `:${detail.id}`
        break
      case 'COMMIT':
        key += `:${detail.nodeId}`
        break
      case 'FINISHED':
        console.log('============GOT A FINISHED EVENT')
        key = `${project.repoOwner}:${project.repoName}:lastUpdated`
        evt = Date.now()
        break
      case 'ERROR':
        console.log(evt)
        continue
    }

    await db.put(key, evt)
  }
  console.log('DONE WITH THIS NOISE')
}

async function * iterateProjects (projects, config) {
  const octokit = await github(config.github)

  // Load projects
  for (const proj of projects) {
    for await (const evt of loadProject(octokit, proj, config)) {
      yield evt
    }
  }

  // wont need to load projects for org bc we pass in all projects
  // Load projects for org
  // for (const org of config.orgs) {
  //   try {
  //     for await (const repo of github.getOrgRepos(octokit, org.name)) {
  //       const proj = new Project({
  //         repoOwner: repo.owner,
  //         repoName: repo.name
  //       })
  //       for await (const evt of loadProject(octokit, proj, config, repo)) {
  //         yield evt
  //       }
  //     }
  //   } catch (e) {
  //     yield projectDetail('ERROR', org, e)
  //   }
  // }
}

async function * loadProject (octokit, project, config, _repo) {
  // If listed from org we already have the repo
  let repo = _repo
  if (!repo) {
    try {
      // console.log('TRYING TO GET REPO FOR PROJ:', project)
      repo = await github.getRepo(octokit, project.repoOwner, project.repoName)
      // console.log('============REPO RES:', repo)
    } catch (e) {
      yield projectDetail('ERROR', project, e)
    }
  }

  let pkg
  try {
    pkg = await files.getPackageJson(project)
  } catch (e) {
    yield projectDetail('ERROR', project, e)
  }

  // In case the package name was not specified, get it from the package.json
  if (!project.packageName && pkg) {
    project.packageName = pkg.name
  }

  // We do this now because then the project has a packageName
  if (repo) {
    yield projectDetail('REPO', project, repo)
  }

  // If we found a package.json we think it is a node package
  if (pkg) {
    yield projectDetail('PACKAGE_JSON', project, pkg)

    try {
      yield projectDetail(
        'PACKUMENT',
        project,
        await npm.getPackument(project.packageName)
      )
    } catch (e) {
      yield projectDetail('ERROR', project, e)
    }

    try {
      yield projectDetail(
        'PACKAGE_MANIFEST',
        project,
        await npm.getManifest(project.packageName)
      )
    } catch (e) {
      yield projectDetail('ERROR', project, e)
    }
  }

  try {
    yield projectDetail(
      'README',
      project,
      await github.getReadme(octokit, project.repoOwner, project.repoName, project.primaryBranch)
    )
  } catch (e) {
    yield projectDetail('ERROR', project, e)
  }

  try {
    yield projectDetail(
      'TRAVIS',
      project,
      await files.getTravisConfig(project)
    )
  } catch (e) {
    yield projectDetail('ERROR', project, e)
  }

  try {
    for await (const issue of github.getRepoIssues(octokit, project.repoOwner, project.repoName)) {
      yield projectDetail('ISSUE', project, issue)
    }
  } catch (e) {
    yield projectDetail('ERROR', project, e)
  }

  try {
    for await (const activity of github.getRepoActivity(octokit, project.repoOwner, project.repoName)) {
      yield projectDetail('ACTIVITY', project, activity)
    }
  } catch (e) {
    yield projectDetail('ERROR', project, e)
  }

  try {
    for await (const commit of github.getRepoCommits(octokit, project.repoOwner, project.repoName)) {
      yield projectDetail('COMMIT', project, commit)
    }
  } catch (e) {
    yield projectDetail('ERROR', project, e)
  }

  console.log('ABOUT TO YIELD FINISHED')
  yield projectDetail('FINISHED', project, {})
}

function projectDetail (type, project, detail) {
  return { type, project, detail }
}
