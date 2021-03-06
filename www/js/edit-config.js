var config_fn, tree_fn;
var speaku, config, config_data, orig_tree_data, tree_data, voices;
// start
Promise.all([
  window.cordova ? NativeAccessApi.onready() : Promise.resolve(),
  new Promise(function(resolve) { // domready
    document.addEventListener('DOMContentLoaded', function() {
      document.removeEventListener('DOMContentLoaded', arguments.callee, false);
      resolve();
    }, false);
  })
])
  .then(initialize_app)
  .then(function() {
    config_fn = default_config;
    tree_fn = default_tree;
    
    return SpeakUnit.getInstance()
      .then(function(_speaku) { speaku = _speaku });
  })
  .then(function() {
    return speaku.get_voices().then(function(v) { voices = v })
  })
  // load data
  .then(function() {
    return get_file_json(config_fn)
      .then(function(_config) { config = _config; config_data = JSON.stringify(config) });
  })
  .then(function() {
    return get_file_data(tree_fn)
      .then(function(_data) { tree_data = _data; orig_tree_data = _data; });
  })
  .then(start)
  .catch(handle_error);

function start() {
  // insert voice options
  var $form = $('form[name=edit-config]').first(),
      voices_by_id = _.object(_.map(voices, function(voice) { return [voice.id,voice] }));
  _.each(_voice_id_links, function(alink) {
    var $inp = $form.find('select[name='+alink[1]+']')
    $inp.on('change', function() {
      var text;
      if(this.value in voices_by_id) {
        text = voices_by_id[this.value].label
      } else {
        text = "Default"
      }
      var opts = {};
      if(this.value)
        opts.voiceId = this.value
      speaku.simple_speak(text, opts)
    })
    var opt = newEl('option')
    opt.value = ''
    opt.textContent = 'Default'
    $inp.append(opt)
    _.each(voices, function(voice) {
      var opt = newEl('option')
      opt.value = voice.id
      opt.textContent = voice.label
      $inp.append(opt)
    });
  });
  
  insert_config()
  insert_tree_data()

  $('#tree-file').on('change', function() {
    if(this.files && this.files.length > 0) {
      var reader = new FileReader();
      reader.onload = function() {
        tree_data = reader.result
        $('form[name=edit-tree] [name=tree-input]').val(tree_data)
      }
      reader.readAsText(this.files[0]);
    }
  });
  $('#tree-revert').on('click', function() {
    tree_data = orig_tree_data
    $('form[name=edit-tree] [name=tree-input]').val(tree_data);
  });
  
  $('form[name=edit-config]').on('submit', save_config)
  $('form[name=edit-tree]').on('submit', save_tree)
}

function validate_number(v, name) {
  var ret = parseFloat(v)
  if(isNaN(ret))
    throw new Error(name + " should be a number");
  return ret;
}
var config_validators = {
  'number': validate_number
};
var _voice_id_links = [
  [ 'auditory_main_voice_options', '_main_voice_id' ],
  [ 'auditory_cue_voice_options', '_cue_voice_id' ],
  [ 'auditory_cue_first_run_voice_options', '_cue_first_run_voice_id' ],
]; 

function insert_config() {
  var $form = $('form[name=edit-config]').first()
  $form.find('input,select,textarea,radio,checkbox').each(function() {
    if(this.name.length > 0 && this.name[0] != '_') {
      var path = this.name.split('.');
      var tmp = config;
      // special case for voice_options, load prefixed data if not avail
      var vo_suffix = 'voice_options';
      if(path[0].indexOf(vo_suffix) == path[0].length - vo_suffix.length) {
        if(!config[path[0]] && config['_'+path[0]])
          path[0] = '_' + path[0];
      }
      for(var i = 0, len = path.length; tmp != null && i < len; ++i) {
        var key = path[i];
        if(i + 1 == len && tmp[key]) {
          if(['radio','checkbox'].indexOf(this.type) != -1) {
            if(this.type == 'checkbox' && typeof tmp[key] == 'boolean') {
              this.checked = tmp[key];
            } else {
              this.checked = this.value == tmp[key]+'';
            }
            $(this).trigger('change');
          } else {
            this.value = tmp[key]+'';
          }
        } else {
          tmp = tmp[key]
        }
      }
    }
  });
  // specific
  if(config.auto_keys) {
    var forward_key = (config.auto_keys['13'] &&
                       config.auto_keys['13'].func == 'tree_go_in' ? 'enter' :
                       (config.auto_keys['32'] &&
                        config.auto_keys['32'].func == 'tree_go_in' ? 'space':
                        null))
    $form.find('[name=_auto_forward_key]').each(function() {
      this.checked = this.value == forward_key
    })
  }
  if(config.switch_keys) {
    var forward_key = (config.switch_keys['13'] &&
                       config.switch_keys['13'].func == 'tree_go_in'?'enter':
                       (config.switch_keys['32'] &&
                        config.switch_keys['32'].func == 'tree_go_in'?'space':
                        null))
    $form.find('[name=_switch_forward_key]').each(function() {
      this.checked = this.value == forward_key
    })
  }
  _.each(_voice_id_links, function(alink) {
    var propname = (speaku.is_native ? '' : 'alt_') + 'voiceId',
        part = config[alink[0]] || config['_' + alink[0]],
        vid = part ? part[propname] : null;
    $form.find('[name='+alink[1]+']').val(vid || '')
  });
  $form.find('[name=_cue_first_active]')
    .prop('checked', !!config.auditory_cue_first_run_voice_options)
    .trigger('change');
}

function insert_tree_data() {
  var $form = $('form[name=edit-tree]').first()
  $form.find('[name=tree-input]').val(tree_data)
}

function save_config(evt) {
  evt.preventDefault();
  var $form = $('form[name=edit-config]').first()
  var _config = JSON.parse(config_data);
  // validate & apply input
  try {
    $form.find('input,select,textarea').each(function() {
      if(this.name.length > 0 && this.name[0] != '_') {
        var path = this.name.split('.'),
            validator_attr = this.getAttribute('data-validator'),
            validator = validator_attr ? config_validators[validator_attr] : null;
        if(validator_attr && !validator)
          throw new Error("Validator not found " + validator_attr + " for " + this.name);
        var value = validator ? validator(this.value, this.name) : this.value;
        var tmp = _config;
        for(var i = 0, len = path.length; i < len; ++i) {
          var key = path[i];
          if(i + 1 == len) {
            if(this.type == 'checkbox') {
              if(!this.value || this.value.toLowerCase() == 'on') {
                // is boolean
                tmp[key] = this.checked
              } else {
                if(this.checked)
                  tmp[key] = value
                else
                  delete tmp[key]
              }
            } else if(this.type == 'radio') {
              if(this.checked) {
                tmp[key] = this.value
              }
            } else {
              tmp[key] = value;
            }
          } else {
            if(tmp[key] == null)
              tmp[key] = {}; // make an object, simple solution
            tmp = tmp[key]
          }
        }
      }
    });
    // specific
    var $inp = $form.find('[name=_auto_forward_key]:checked'),
        keys = null;
    switch($inp.val()) {
    case 'enter':
      keys = {
        '32': { 'func': 'tree_go_out', 'comment': 'space' },
        '13': { 'func': 'tree_go_in', 'comment': 'enter' }
      }
      break;
    case 'space':
      keys = {
        '32': { 'func': 'tree_go_in', 'comment': 'space' },
        '13': { 'func': 'tree_go_out', 'comment': 'enter' }
      }
      break;
    }
    if(keys)
      _config.auto_keys = Object.assign((_config.auto_keys || {}), keys);
    $inp = $form.find('[name=_switch_forward_key]:checked');
    keys = null;
    switch($inp.val()) {
    case 'enter':
      keys = {
        '32': { 'func': 'tree_go_out', 'comment': 'space' },
        '13': { 'func': 'tree_go_in', 'comment': 'enter' }
      }
      break;
    case 'space':
      keys = {
        '32': { 'func': 'tree_go_in', 'comment': 'space' },
        '13': { 'func': 'tree_go_out', 'comment': 'enter' }
      }
      break;
    }
    if(keys)
      _config.switch_keys = Object.assign((_config.switch_keys || {}), keys);
    _.each(_voice_id_links, function(alink) {
      var propname = (speaku.is_native ? '' : 'alt_') + 'voiceId',
          str = $form.find('[name='+alink[1]+']').val()
      if(!_config[alink[0]])
        _config[alink[0]] = {}
      if(str)
        _config[alink[0]][propname] = str
      else
        delete _config[alink[0]][propname]
    });
    if(!$form.find('[name=_cue_first_active]').prop('checked')) {
      _config._auditory_cue_first_run_voice_options =
        _config.auditory_cue_first_run_voice_options;
      delete _config.auditory_cue_first_run_voice_options;
    } else {
      delete _config._auditory_cue_first_run_voice_options;
    }
  } catch(err) {
    $form.find('.save-section .alert-danger')
      .html(error_to_html(err))
      .toggleClass('alert-hidden', false);
    return;
  }
  // then save
  // console.log(_config)
  $form.find('.save-section .alert').html('').toggleClass('alert-hidden', true)
  set_file_data(config_fn, JSON.stringify(_config, null, "  "))
    .then(function() {
      config = _config
      $form.find('.save-section .alert-success')
        .html('<strong>Success!</strong>')
        .toggleClass('alert-hidden', false);
    })
    .catch(function(err) {
      $form.find('.save-section .alert-danger')
        .html(error_to_html(err))
        .toggleClass('alert-hidden', false);
    })
}

function save_tree(evt) {
  evt.preventDefault();
  var $form = $('form[name=edit-tree]').first()
  // validate & apply input
  tree_data = $form.find('[name=tree-input]').val()
  // then save
  $form.find('.save-section .alert').html('').toggleClass('alert-hidden', true)
  set_file_data(tree_fn, tree_data)
    .then(function() {
      $form.find('.save-section .alert-success')
        .html('<strong>Success!</strong>')
        .toggleClass('alert-hidden', false);
    })
    .catch(function(err) {
      $form.find('.save-section .alert-danger')
        .html(error_to_html(err))
        .toggleClass('alert-hidden', false);
    });
}

function error_to_html(err) {
  return '<strong>Error:</strong> ' + (err+'').replace(/^error:\s*/i, "")
}

// basic editing features (driven with markup)
$(document).on('change', 'input[type=checkbox],input[type=radio]', function() {
  var el = this,
      $el = $(el);
  if(this.type == 'radio' && !this._others_triggered) {
    // trigger change for all with same name
    $el.parents('form').find('input[type=radio]').each(function() {
      if(this.name == el.name && el != this) {
        this._others_triggered = true;
        $(this).trigger('change');
        delete this._others_triggered;
      }
    })
  }
  var vis_edit = $el.data('toggle-visibility')
  if(vis_edit) {
    $(vis_edit).toggleClass('visibility-dependant-visible', this.checked);
  }
});

