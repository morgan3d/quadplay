GIT = git
GITSTATUS := $(shell git diff-index --quiet HEAD . 1>&2 2> /dev/null; echo $$?)
DEPLOY_BRANCH = "DEPLOY_ACROSS"
DEV_BRANCH = "rock"
DEPLOY_REMOTE = git@github.com:ssteinbach/btw_deploy_test.git

GAME_NAME = "across_the_lake"
GAME_VERSION = 1.0.0
ITCH_RELEASE_FILE = $(GAME_NAME).$(GAME_VERSION).zip

itch:
ifneq ($(GITSTATUS), 0)
	$(error "Git repository is dirty, cannot deploy. Run 'git status' for more info")
endif
	@echo "running from: " $(PWD)
	@echo "Remove previous release if it exists."
	-@rm -rf $(ITCH_RELEASE_FILE)
	python3 ../../tools/export.py -z $(ITCH_RELEASE_FILE)
	@echo "done, made $(PWD)/$(ITCH_RELEASE_FILE)"

