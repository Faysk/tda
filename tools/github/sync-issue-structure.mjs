import { readFile } from "node:fs/promises";

const repository = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN;

if (!repository || !token) {
  throw new Error("GITHUB_REPOSITORY and GITHUB_TOKEN are required");
}

const [owner, repo] = repository.split("/");
if (!owner || !repo) {
  throw new Error(`Invalid GITHUB_REPOSITORY: ${repository}`);
}

const config = JSON.parse(
  await readFile(new URL("./issue-structure.json", import.meta.url), "utf8"),
);

if (config.version !== 1) {
  throw new Error(`Unsupported issue structure config version: ${config.version}`);
}

const headers = {
  Accept: "application/vnd.github+json",
  Authorization: `Bearer ${token}`,
  "X-GitHub-Api-Version": "2026-03-10",
};

const api = async (path, init = {}) => {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      ...headers,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers || {}),
    },
  });

  if (!response.ok) {
    throw new Error(
      `${init.method || "GET"} ${path} failed: ${response.status} ${await response.text()}`,
    );
  }

  if (response.status === 204) return null;
  return response.json();
};

const issueCache = new Map();
const getIssue = async (number) => {
  if (!issueCache.has(number)) {
    issueCache.set(
      number,
      await api(`/repos/${owner}/${repo}/issues/${number}`),
    );
  }
  return issueCache.get(number);
};

const setIssue = (number, value) => {
  issueCache.set(number, value);
};

let milestonesCreated = 0;
let milestoneAssignments = 0;
let subIssuesAdded = 0;
let dependenciesAdded = 0;

const milestones = await api(
  `/repos/${owner}/${repo}/milestones?state=all&per_page=100`,
);
const milestonesByTitle = new Map(
  milestones.map((milestone) => [milestone.title, milestone]),
);

for (const desired of config.milestones) {
  let milestone = milestonesByTitle.get(desired.title);

  if (!milestone) {
    milestone = await api(`/repos/${owner}/${repo}/milestones`, {
      method: "POST",
      body: JSON.stringify({
        title: desired.title,
        state: "open",
        description: desired.description,
      }),
    });
    milestonesByTitle.set(desired.title, milestone);
    milestonesCreated++;
    console.log(`MILESTONE_CREATED #${milestone.number} ${desired.title}`);
  } else {
    const descriptionMatches =
      (milestone.description || "") === desired.description;
    if (milestone.state !== "open" || !descriptionMatches) {
      milestone = await api(
        `/repos/${owner}/${repo}/milestones/${milestone.number}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            title: desired.title,
            state: "open",
            description: desired.description,
          }),
        },
      );
      milestonesByTitle.set(desired.title, milestone);
      console.log(`MILESTONE_UPDATED #${milestone.number} ${desired.title}`);
    } else {
      console.log(`MILESTONE_OK #${milestone.number} ${desired.title}`);
    }
  }

  for (const issueNumber of desired.issues) {
    const issue = await getIssue(issueNumber);
    if (issue.pull_request) {
      throw new Error(`#${issueNumber} is a pull request, not an issue`);
    }

    if (issue.milestone?.number === milestone.number) {
      console.log(`MILESTONE_ASSIGNMENT_OK #${issueNumber} -> ${desired.title}`);
      continue;
    }

    if (issue.milestone && issue.milestone.number !== milestone.number) {
      throw new Error(
        `#${issueNumber} already belongs to milestone #${issue.milestone.number} (${issue.milestone.title}); refusing silent reassignment to ${desired.title}`,
      );
    }

    const updated = await api(
      `/repos/${owner}/${repo}/issues/${issueNumber}`,
      {
        method: "PATCH",
        body: JSON.stringify({ milestone: milestone.number }),
      },
    );
    setIssue(issueNumber, updated);
    milestoneAssignments++;
    console.log(`MILESTONE_ASSIGNED #${issueNumber} -> ${desired.title}`);
  }
}

for (const relation of config.parents) {
  const parent = await getIssue(relation.parent);
  if (parent.pull_request) {
    throw new Error(`Parent #${relation.parent} is a pull request`);
  }

  const existing = await api(
    `/repos/${owner}/${repo}/issues/${relation.parent}/sub_issues?per_page=100`,
  );
  const existingNumbers = new Set(existing.map((issue) => issue.number));

  for (const childNumber of relation.children) {
    if (existingNumbers.has(childNumber)) {
      console.log(`SUB_ISSUE_OK #${relation.parent} -> #${childNumber}`);
      continue;
    }

    const child = await getIssue(childNumber);
    if (child.pull_request) {
      throw new Error(`Child #${childNumber} is a pull request`);
    }

    await api(
      `/repos/${owner}/${repo}/issues/${relation.parent}/sub_issues`,
      {
        method: "POST",
        body: JSON.stringify({ sub_issue_id: child.id }),
      },
    );
    subIssuesAdded++;
    console.log(`SUB_ISSUE_ADDED #${relation.parent} -> #${childNumber}`);
  }
}

for (const relation of config.blockedBy) {
  const issue = await getIssue(relation.issue);
  if (issue.pull_request) {
    throw new Error(`Dependency target #${relation.issue} is a pull request`);
  }

  const existing = await api(
    `/repos/${owner}/${repo}/issues/${relation.issue}/dependencies/blocked_by?per_page=100`,
  );
  const existingNumbers = new Set(existing.map((dependency) => dependency.number));

  for (const blockerNumber of relation.blockers) {
    if (existingNumbers.has(blockerNumber)) {
      console.log(`DEPENDENCY_OK #${relation.issue} blocked by #${blockerNumber}`);
      continue;
    }

    const blocker = await getIssue(blockerNumber);
    if (blocker.pull_request) {
      throw new Error(`Blocker #${blockerNumber} is a pull request`);
    }

    await api(
      `/repos/${owner}/${repo}/issues/${relation.issue}/dependencies/blocked_by`,
      {
        method: "POST",
        body: JSON.stringify({ issue_id: blocker.id }),
      },
    );
    dependenciesAdded++;
    console.log(`DEPENDENCY_ADDED #${relation.issue} blocked by #${blockerNumber}`);
  }
}

console.log(
  [
    "ISSUE_STRUCTURE_SYNC_OK",
    `milestones_created=${milestonesCreated}`,
    `milestone_assignments=${milestoneAssignments}`,
    `sub_issues_added=${subIssuesAdded}`,
    `dependencies_added=${dependenciesAdded}`,
  ].join(" "),
);
