# gitdiff

Keeps 3 GIT-repos inc sync (Base+Diff=>Merged)

Usage: gitdiff branch1,branch2,branch3 repo1 repo2 repo3

- repo1 = base
- repo2 = diff
- repo3 = merged

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

