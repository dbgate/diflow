# gitdiff

Keeps 3 GIT-repos inc sync (Base+Diff=>Merged)

Usage: gitdiff configrepo

In config repo, there should be following config.json:

{
  "branches": ["master"],
  "repos": {
    "repo1": "path_to_base_repo",
    "repo2": "path_to_diff_repo",
    "repo3": "path_to_merged_repo"
  }
}

1. Process only branches in list
2. Loop through all commits from all 3 repos, process not processed commits

Commit from repo1:
Add file - add this file also to repo3, only if it doesn't exist in repo2
Remove file - remove this file from repo3, only if it doesn't exist in repo2
Modify file - modify this file in repo3, only if it doesn't exist in repo2

Commit from repo2:
Add file - add or overwrite this file in repo3
Remove file - remove this file from repo3, only if it doesn't exist in repo1
Modify file - modify and overwrite this file in repo3

Commit from repo3:
Add file - add this file to repo2
Remove file - remove this file from repo1 and repo2
Modify file - Modify this file in repo2, if it exists in repo2, if it doesn't exist in repo2, modify this file in repo1

