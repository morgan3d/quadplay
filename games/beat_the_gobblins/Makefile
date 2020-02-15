GIT = git
GITSTATUS := $(shell git diff-index --quiet HEAD . 1>&2 2> /dev/null; echo $$?)
DEPLOY_BRANCH = "DEPLOY_BTW"
DEV_BRANCH = "beat_the_wizard"

GAME_NAME = "beat_the_gobblins"
GAME_VERSION = 1.0.0
ITCH_RELEASE_FILE = $(GAME_NAME).$(GAME_VERSION).zip

all:
	@echo "Updating all sprites..."
	@../../tools/sprite_json_generator.py -u

# this target deploys to a github repo that you can then point at with a url like:
# https://morgan3d.github.io/quadplay/console/quadplay.html?game=https://<USER_NAME>.github.io/<DEPLOY_REPO_NAME>/<GAME_NAME>.game.json
# the target needs to be something like: DEPLOY_REMOTE = git@github.com:<USER_NAME>/<DEPLOY_REPO_NAME>.git
deploy:
ifneq ($(GITSTATUS), 0)
	$(error "Git repository is dirty, cannot deploy. Run 'git status' for more info")
endif
	@echo "Moving deploy branch"
	$(GIT) checkout $(DEPLOY_BRANCH)
	$(GIT) reset --hard $(DEV_BRANCH)
	$(GIT) init
	$(GIT) add .
	$(GIT) commit -m "Snapshot for deployment"
	$(GIT) remote add deploy $(DEPLOY_REMOTE)
	$(GIT) push deploy master --force
	@rm -rf .git
	$(GIT) checkout $(DEV_BRANCH)
	@echo "Deploy branch is now moved." 

# make a zipfile for itch
itch:
ifneq ($(GITSTATUS), 0)
	$(error "Git repository is dirty, cannot deploy. Run 'git status' for more info")
endif
	@echo "running from: " $(PWD)
	@echo "Remove previous release if it exists."
	-@rm -rf $(ITCH_RELEASE_FILE)
	python3 ../../tools/export.py -z $(ITCH_RELEASE_FILE)
	@echo "done, made $(PWD)/$(ITCH_RELEASE_FILE)"
