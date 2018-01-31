var path = require('path'),
    Datastore = require('nedb'),
    db = new Datastore({ filename: path.resolve(process.env.PWD, 'db/webide_data_store'), autoload: true }),
    git = require('gitty'),
    url = require('url'),
    winston = require('winston'),
    fs_helper = require('./fs_helper'),
    request_helper = require('./request_helper'),
    config = require('../config/config');

var REPOSITORY_PATH = path.resolve(__dirname + "/../repositories") + "/";
var push_queue = [], pushInterval, PUSH_TIMER = 30000;

/*
 * Creates a simple queue that is used for pushing git changes to the remote repositories.
 * The queue is currently set using the PUSH_TIMER to delay the remote pushes.
 */
function push_queue_interval() {
  console.log('git push queue init');
  function push(repository_path, remote, branch, username) {
    git.push(repository_path, remote, branch, function(obj) {
      require('../server').get_socket(username, function(socket) {
        if (obj.error) {
          winston.error(obj);
          socket.emit('git-push-error', {err: "Error: Failure pushing code to remote repository"});
        }
        //console.log(obj);
      });
    });
  }

  pushInterval = setInterval(function() {
    if (config.editor.offline || config.editor.github) {
      return;
    }

    while(push_queue.length > 0) {
      console.log('pushing code to remote repository');
      var element = push_queue.shift();
      push(element.repository_path, element.remote, element.branch, element.username);
    }
  }, PUSH_TIMER);
}
push_queue_interval();

/*
 * Clone the adafruit libraries defined in config/config.js.
 * We start the editor off with the Adafruit libraries that may be useful to beginners.
 */
exports.clone_adafruit_libraries = function(adafruit_repository, remote, cb) {
  fs_helper.check_for_repository(adafruit_repository, function(err, status) {
    if (!err && !status) {
      git.clone(REPOSITORY_PATH, remote, function(output) {
        console.log(output);
        cb(true);
      });
    } else {
      cb(false);
    }
  });
};

/*
 * This does a few things in order to clone a repository, and save it to your Bitbucket profile.
 * This allows you to clone from any remote repository, including Github (it's overly complicated...).
 * 1. It first checks if the repository already exists in your bitbucket profile.
 * 2. If not 1, it creates the repository in Bitbucket using the API.
 * 3. It then clones the remote repository you're interested in.
 * 4. It then updates the git remote for that repository to your bitbucket repository.
 * 5. Finally, it pushes the cloned repository to your remote account.
 */
exports.clone_update_remote_push = function(profile, repository_url, retain_remote, cb) {
  var self = this;

  var repository_name = path.basename(repository_url, '.git');

  self.clone_repository(repository_url, function(err, results) {
    console.log("clone repository locally: " + repository_name);
    cb(err, true);
  });
};

exports.clone_repository = function(repository_path, cb) {
  console.log(repository_path);
  var repository_url = url.parse(repository_path);

  console.log("cloning", repository_path);
  git.clone(REPOSITORY_PATH, repository_url.href, function(output) {
    cb(output.error, output.message);
  });
};

exports.validate_config = function validate_config(cb) {
  git.config("user.email", null, function(err, email) {
    git.config("user.name", null, function(err, name) {
      if (err) winston.error("git_helper.validate_config err", err);

      if (name && email) {
        cb(true);
      } else {
        cb(false);
      }
    });
  });
};

exports.set_config = function(cb) {
  var self = this;
  self.validate_config(function(is_valid) {
    if (is_valid) {
      console.log('git config is valid');
      cb();
    } else {
      winston.error('git config is invalid');
      db.findOne({type: "user"}, function (err, user) {
        console.log("set_config user", user);
        git.config("user.email", user.email, function(err, email) {
          git.config("user.name", user.name, function(err, name) {
            console.log("git config set", email, name);
            cb();
          });
        });
      });
    }
  });

};

/*
 * Updates the remote repository to the users bitbucket repository.
 */
exports.update_remote = function(profile, repository, cb) {
  var remote_url = "ssh://git@bitbucket.org/" + profile.username + "/" + repository.toLowerCase() + ".git";
  git.remote.update(REPOSITORY_PATH + repository, "origin", remote_url, function(output) {
    //console.log(output);
    cb(output.error, output.message);
  });
};

/*
 * Adds an additional remote to a repository.
 */
exports.add_remote = function(repository, remote_name, remote_url, cb) {
  git.remote.add(REPOSITORY_PATH + repository, remote_name, remote_url, function(output) {
    //console.log(output);
    cb(output.error, output.message);
  });
};

/*
 * git add a single file, or an array of files.
 * repository: the name of the repository that resides in the repositories folder.
 * files: the relative path of the files from the root of the repository.
 */
exports.add = function add(repository, files, cb) {
  if (!Array.isArray(files)) {
    files = [files];
  }
  var repository_path = REPOSITORY_PATH + repository;
  git.add(repository_path, files, function(output) {
    //console.log(output.errors);
    //console.log(output);
    cb(output.errors, output.added);
  });
};

/*
 * git remove a single file, or an array of files.
 * repository: the name of the repository that resides in the repositories folder.
 * files: the relative path of the files from the root of the repository.
 */
exports.remove = function remove(repository, files, cb) {
  if (!Array.isArray(files)) {
    files = [files];
  }
  var repository_path = REPOSITORY_PATH + repository;
  git.remove(repository_path, files, function(output) {
    //console.log(output.errors);
    cb(output.errors, output.added);
  });
};

/*
 * git remove an entire directory, and it's contents.
 * repository: the name of the repository that resides in the repositories folder.
 * path: the relative path of the directory from the root of the repository.
 */
exports.remove_recursive = function remove_recursive(repository, path, cb) {
  var repository_path = REPOSITORY_PATH + repository;

  git.remove_recursive(repository_path, path, function(output) {
    console.log(output);
    cb(output.errors, output.added);
  });
};

/*
 * git move a single file or folder.
 * repository: the name of the repository that resides in the repositories folder.
 */
exports.move = function move(repository, source, destination, cb) {
  var repository_path = REPOSITORY_PATH + repository;
  git.move(repository_path, source, destination, function(obj) {
    //console.log(obj);
    cb(obj.error, obj.message);
  });
};

/*
 * git commit the changes.
 * repository: the name of the repository that resides in the repositories folder.
 * message: The text to go along with the commit.
 */
exports.commit = function commit(repository, message, cb) {
  var repository_path = REPOSITORY_PATH + repository;
  console.log(repository_path);
  git.commit(repository_path, message, function(obj) {
    //console.log(obj);
    cb(obj.error, obj.message);
  });
};

/*
 * git status a single file.
 * file: the relative path of the file from the root of the repository.
 */
exports.is_modified = function (file, cb) {
  var path_array = file.path.split('/');
  var repository = path_array[2];
  var repository_path = path.resolve(REPOSITORY_PATH, repository);
  var item_path = path_array.slice(3).join('/');

  var is_modified = false;
  git.status(repository_path, function(output) {

    console.log(output);

    if (output.not_staged.length > 0) {
      output.not_staged.forEach(function(item, index) {
        if (item.file === item_path) {
          is_modified = true;
        }
      });
    }

    if (output.untracked.indexOf(item_path) !== -1) {
      is_modified = true;
    }

    cb(output.errors, is_modified);
  });
};

/*
 * git status a single file to check if it's untracked.
 * file: the relative path of the file from the root of the repository.
 */
exports.is_untracked = function (file, cb) {
  var path_array = file.path.split('/');
  var repository = path_array[2];
  var repository_path = path.resolve(REPOSITORY_PATH, repository);
  var item_path = path_array.slice(3).join('/');

  console.log(item_path);

  var is_untracked = false;
  git.status(repository_path, function(output) {

    console.log(output);

    if (output.untracked.indexOf(item_path) !== -1) {
      is_untracked = true;
    }

    cb(output.errors, is_untracked);
  });
};

/*
 * git push the committed changes.  Adds it to the push queue.
 * repository: the name of the repository that resides in the repositories folder.
 */
exports.push = function push(repository, remote, branch, profile, cb) {
  var repository_path = REPOSITORY_PATH + repository;
  var key = repository + remote + branch;
  console.log('called push ' + key);

  //if the repository, remote and branch are already on the queue, just skip it...otherwise add it to the end
  if (push_queue.length > 0) {
    for (var i=0; i<push_queue.length; i++) {
      if (push_queue[i].key === key) {
        break;
      } else {
        console.log('added to queue ' + key);
        push_queue.push({
          key: key,
          repository_path: repository_path,
          repository: repository,
          remote: remote,
          branch: branch,
          username: profile ? profile.username : ''
        });
      }
    }
  } else {
    push_queue.push({
      key: key,
      repository_path: repository_path,
      repository: repository,
      remote: remote,
      branch: branch,
      username: profile ? profile.username : ''
    });
  }
  cb();
};

/*
 * git pull remote changes to the repository.
 * repository: the name of the repository that resides in the repositories folder.
 */
exports.pull = function pull(repository, remote, branch, cb) {
  var repository_path = REPOSITORY_PATH + repository;
  git.pull(repository_path, remote, branch, function(obj) {
    //console.log(obj);
    if (obj.error) {
      winston.error(obj.error);
      cb("Error: Failure updating from remote repository", obj.message);
    } else {
      cb(null, obj.message);
    }

  });
};

/*
 * Simply removes a file or directory, commits it, and pushes it out.
 */
exports.remove_commit_push = function(item, profile, cb) {
  var self = this;
  console.log(item);
  var path_array = item.path.split('/');
  var repository = path_array[2];
  var item_path = path_array.slice(3).join('/');
  console.log(item_path);
  console.log(repository);


  if (item.type === 'directory') {
    self.remove_recursive(repository, item_path, function(err, status) {
      var commit_message = "Removed " + item.name;
      if (err && err.length > 0) {
        cb("Error: Failure removing folder from git", status);
        return;
      }
      self.commit(repository, commit_message,  function(err, status) {
        if (err && err.length > 0) {
          cb("Error: Failure comitting removed folder", status);
          return;
        }
        self.push(repository, "origin", "master", profile, function() {
          cb();
        });
      });
    });
  } else {
    self.remove(repository, item_path, function(err, status) {
      if (err && err.length > 0) {
        cb("Error: Failure removing file from git", status);
        return;
      }
      var commit_message = "Removed " + item.name;
      self.commit(repository, commit_message,  function(err, status) {
        if (err && err.length > 0) {
          cb("Error: Failure comitting removed file", status);
          return;
        }
        self.push(repository, "origin", "master", profile, function() {
          cb();
        });
      });
    });
  }
};

/*
 * Simply moves a file or directory, commits it, and pushes it out.
 */
exports.move_commit_push = function(item, profile, cb) {
  var self = this;
  var path_array = item.path.split('/');
  var repository = path_array[2];
  var item_path = path_array.slice(3).join('/');
  var destination_path = item.destination.split('/').slice(3).join('/');

  self.is_untracked(item, function(err, is_untracked) {
    if (is_untracked) {
      item_path = path.resolve(REPOSITORY_PATH, repository, item_path);

      destination_path = path.resolve(REPOSITORY_PATH, repository, destination_path);
      fs_helper.rename(item_path, destination_path, function(err) {
        cb(err);
      });
    } else {
      self.move(repository, item_path, destination_path, function(err, status) {
        var commit_message = "Moved " + item.name;
        if (err) {
          console.log ("has error returning");
          cb("Error: Failure moving file (renaming)");
          return;
        }
        self.commit(repository, commit_message,  function(err, status) {
          console.log("Committed Moved File");
          if (err) {
            cb("Error: Failure comitting file into git");
            return;
          }
          self.push(repository, "origin", "master", profile, function() {
            console.log("Pushed latest changes");
            cb();
          });
        });
      });
    }
  });

};

/*
 * Simply commits a file or directory, commits it, and pushes it out.
 */
exports.commit_push_and_save = function(file, commit_message, profile, cb) {
  var self = this,
      path_array, repository, file_path;
  if (!file.repository) {
    path_array = file.path.split('/');
    repository = path_array[2];
    file_path = path_array.slice(3).join('/');
  } else {
    repository = file.repository;
    file_path = file.path;
  }

  console.log(commit_message);



  self.add(repository, file_path, function(err, status) {
    console.log("added", err, status);
    if (err && err.length > 0) {
      cb("Error: Failure adding file to git", status);
      return;
    }
    self.commit(repository, commit_message,  function(err, status) {
      console.log("committed", err, status);
      if (err && err.length > 0) {
        cb("Error: Failure comitting file into git", status);
        return;
      }
      self.push(repository, "origin", "master", profile, function() {
        console.log("added to push queue");
        cb();
      });
    });
  });
};
