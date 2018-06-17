const Sequelize = require("sequelize");
const Op = Sequelize.Op;
const {models} = require("../models");
const cloudinary = require('cloudinary');
const fs = require('fs');
const attHelper = require("../helpers/attachments");

const paginate = require('../helpers/paginate').paginate;

// Optios for the files uploaded to Cloudinary
const cloudinary_upload_options = {
    async: true,
    folder: "/core/quiz2018/attachments",
    resource_type: "auto",
    tags: ['core', 'quiz']
};

// Autoload the quiz with id equals to :quizId
exports.load = (req, res, next, quizId) => {

    const options = {
        include: [
            {
                model: models.attachment
            },
            {
                model: models.tip,
                include: [
                    {
                        model: models.user, as: 'author'
                    }
                ]
            },
            {
                model: models.user, as: 'author'
            }
        ]
    };

    // For logged users: include the favourites of the questions
    // by filtering by the logged user in the outer join.
    if ( req.session.user ){
        options.include.push({
            model: models.user,
            as: "fans",
            where: { id: req.session.user.id },
            required: false // OUTER JOIN
        })
    }
    models.quiz.findById(quizId, options)
    .then(quiz => {
        if (quiz) {
            req.quiz = quiz;
            next();
        } else {
            throw new Error('There is no quiz with id =' + quizId);
        }
    })
    .catch(error => next(error));
};


// MW that allows actions only if the user logged in is admin or is the author of the quiz.
exports.adminOrAuthorRequired = (req, res, next) => {

    const isAdmin  = !!req.session.user.isAdmin;
    const isAuthor = req.quiz.authorId === req.session.user.id;

    if (isAdmin || isAuthor) {
        next();
    } else {
        console.log('Prohibited operation: The logged in user is not the author of the quiz, nor an administrator.');
        res.send(403);
    }
};


// GET /quizzes
exports.index = (req, res, next) => {

    let countOptions = {
        where: {},
        include: []
    };

    const searchfavourites = req.query.searchfavourites || "";
    let title = "Questions";
    let yourquestions = "";


    let NTotalQ = 0;

    // Search:
    const search = req.query.search || '';
    if (search) {
        const search_like = "%" + search.replace(/ +/g,"%") + "%";

        countOptions.where.question = { [Op.like]: search_like };
    }

    // If there exists "req.user", then only the quizzes of that user are shown
    if (req.user) {
        countOptions.where.authorId = req.user.id;
        if ( req.sessision.user && req.session.user.id === req.user.id) {
            title = "My Questions";
        } else {
            title = "Questions of " + req.user.username;
        }
    }

    // Filter: my favourite quizzes:
    if (req.session.user) {
        if (searchfavourites) {
            countOptions.include.push({
                model: models.user,
                as: "fans",
                where: {id: req.session.user.id},
                attributes: ['id']

            });
        } else {

            // NOTE:
            // It should be added the options ( or similars )
            // to have a lighter query:
            //    where: {id: req.session.user.id},
            //    required: false  // OUTER JOIN
            // but this does not work with SQLite. The generated
            // query fails when there are several fans of the same quiz.

            countOptions.include.push({
                model: models.user,
                as: "fans",
                attributes: ['id']
            });
        }
    }

    models.quiz.count()
        .then((c) => {
            NTotalQ = c;
        })
        .then(() => {
            models.quiz.count(countOptions)
        })
        .then(count => {

                // Pagination:

                const items_per_page = 10;

                // The page to show is given in the query
                const pageno = parseInt(req.query.pageno) || 1;

                // Create a String with the HTMl used to render the pagination buttons.
                // This String is added to a local variable of res, which is used into the application layout file.
                res.locals.paginate_control = paginate(count, items_per_page, pageno, req.url);

                // Se hallan todos lo quizzes.


                const findOptions = {
                    ...countOptions,
                    offset: items_per_page * (pageno - 1),
                    limit: items_per_page,
                    // include: [
                    //     models.attachment,
                    //     {model: models.user, as: 'author'}
                    //]
                };

                findOptions.include.push(models.attachment);
                findOptions.include.push({
                    model: models.user,
                    as: 'author'
                });

                return models.quiz.findAll(findOptions);
            })

        .then((quizzes) => {

            if(req.user) { // If my quizzes
                yourquestions = "You have " + quizzes.length + " quiz(zes)."
            }

            // Mark favourite quizzes:
            if (req.session.user){
                quizzes.forEach(quiz => {
                    quiz.favourite = quiz.fans.some(fan => {
                        return fan.id === req.session.user.id;
                    });
                });
            }

            res.render('quizzes/index.ejs', {
                quizzes,
                NTotalQ,
                search,
                cloudinary,
                title,
                searchfavourites,
                yourquestions
            });
        })
        .catch(error => next(error));
    };


// GET /quizzes/:quizId
exports.show = (req, res, next) => {

    const {quiz} = req;

    new Promise((resolve, reject) => {

        // Only for logged users:
        // if this quiz is one of my favourites, then i create the
        // attribute "favourite = true"
        if ( req.session.user) {
            resolve(
                req.quiz.getFans({where: {id: req.session.user.id}})
                .then(fans => {
                    if (fans.length > 0){
                        req.quiz.favourite = true;
                    }
                })
            );
        } else {
            resolve();
        }
    })
        .then( () => {
            res.render('quizzes/show', {
                quiz,
                cloudinary
            })
        })
        .catch(error => next(error));
};


// GET /quizzes/new
exports.new = (req, res, next) => {

    const quiz = {
        question: "",
        answer: ""
    };

    res.render('quizzes/new', {quiz});
};

// POST /quizzes/create
exports.create = (req, res, next) => {

    const {question, answer} = req.body;

    const authorId = req.session.user && req.session.user.id || 0;

    const quiz = models.quiz.build({
        question,
        answer,
        authorId
    });

    // Saves only the fields question and answer into the DDBB
    quiz.save({fields: ["question", "answer", "authorId"]})
    .then(quiz => {
        req.flash('success', 'Quiz created successfully.');

        if (!req.file) {
            req.flash('info', 'Quiz without attachment.');
            res.redirect('/quizzes/' + quiz.id);
            return;
        }

        // Save the attachment into  Cloudinary
        return attHelper.checksCloudinaryEnv()
        .then(() => {
            return attHelper.uploadResourceToCloudinary(req.file.path, cloudinary_upload_options);
        })
        .then(uploadResult => {

            // Create the new attachment into the data base.
            return models.attachment.create({
                public_id: uploadResult.public_id,
                url: uploadResult.url,
                filename: req.file.originalname,
                mime: req.file.mimetype,
                quizId: quiz.id })
            .then(attachment => {
                req.flash('success', 'Image saved successfully.');
            })
            .catch(error => { // Ignoring validation errors
                req.flash('error', 'Failed to save file: ' + error.message);
                cloudinary.api.delete_resources(uploadResult.public_id);
            });

        })
        .catch(error => {
            req.flash('error', 'Failed to save attachment: ' + error.message);
        })
        .then(() => {
            fs.unlink(req.file.path); // delete the file uploaded at./uploads
            res.redirect('/quizzes/' + quiz.id);
        });
    })
    .catch(Sequelize.ValidationError, error => {
        req.flash('error', 'There are errors in the form:');
        error.errors.forEach(({message}) => req.flash('error', message));
        res.render('quizzes/new', {quiz});
    })
    .catch(error => {
        req.flash('error', 'Error creating a new Quiz: ' + error.message);
        next(error);
    });
};


// GET /quizzes/:quizId/edit
exports.edit = (req, res, next) => {

    const {quiz} = req;

    res.render('quizzes/edit', {quiz});
};


// PUT /quizzes/:quizId
exports.update = (req, res, next) => {

    const {quiz, body} = req;

    quiz.question = body.question;
    quiz.answer = body.answer;

    quiz.save({fields: ["question", "answer"]})
    .then(quiz => {
        req.flash('success', 'Quiz edited successfully.');

        if (!body.keepAttachment) {

            // There is no attachment: Delete old attachment.
            if (!req.file) {
                req.flash('info', 'This quiz has no attachment.');
                if (quiz.attachment) {
                    cloudinary.api.delete_resources(quiz.attachment.public_id);
                    quiz.attachment.destroy();
                }
                return;
            }

            // Save the new attachment into Cloudinary:
            return attHelper.checksCloudinaryEnv()
            .then(() => {
                return attHelper.uploadResourceToCloudinary(req.file.path, cloudinary_upload_options);
            })
            .then(function (uploadResult) {

                // Remenber the public_id of the old image.
                const old_public_id = quiz.attachment ? quiz.attachment.public_id : null;

                // Update the attachment into the data base.
                return quiz.getAttachment()
                .then(function(attachment) {
                    if (!attachment) {
                        attachment = models.attachment.build({ quizId: quiz.id });
                    }
                    attachment.public_id = uploadResult.public_id;
                    attachment.url = uploadResult.url;
                    attachment.filename = req.file.originalname;
                    attachment.mime = req.file.mimetype;
                    return attachment.save();
                })
                .then(function(attachment) {
                    req.flash('success', 'Image saved successfully.');
                    if (old_public_id) {
                        cloudinary.api.delete_resources(old_public_id);
                    }
                })
                .catch(function(error) { // Ignoring image validation errors
                    req.flash('error', 'Failed saving new image: '+error.message);
                    cloudinary.api.delete_resources(uploadResult.public_id);
                });


            })
            .catch(function(error) {
                req.flash('error', 'Failed saving the new attachment: ' + error.message);
            })
            .then(function () {
                fs.unlink(req.file.path); // delete the file uploaded at./uploads
            });
        }
    })
    .then(function () {
        res.redirect('/quizzes/' + req.quiz.id);
    })
    .catch(Sequelize.ValidationError, error => {
        req.flash('error', 'There are errors in the form:');
        error.errors.forEach(({message}) => req.flash('error', message));
        res.render('quizzes/edit', {quiz});
    })
    .catch(error => {
        req.flash('error', 'Error editing the Quiz: ' + error.message);
        next(error);
    });
};


// DELETE /quizzes/:quizId
exports.destroy = (req, res, next) => {

    // Delete the attachment at Cloudinary (result is ignored)
    if (req.quiz.attachment) {
        attHelper.checksCloudinaryEnv()
        .then(() => {
            cloudinary.api.delete_resources(req.quiz.attachment.public_id);
        });
    }

    req.quiz.destroy()
    .then(() => {
        req.flash('success', 'Quiz deleted successfully.');
        res.redirect('/goback');
    })
    .catch(error => {
        req.flash('error', 'Error deleting the Quiz: ' + error.message);
        next(error);
    });
};


// GET /quizzes/:quizId/play
exports.play = (req, res, next) => {

    const {quiz, query} = req;

    const answer = query.answer || '';

    new Promise(function (resolve, reject) {

        // Only for logger users:
        //   if this quiz is one of my fovourites, then I create
        //   the attribute "favourite = true"
        if (req.session.user) {
            resolve(
                req.quiz.getFans({where: {id: req.session.user.id}})
                    .then(fans => {
                        if (fans.length > 0) {
                            req.quiz.favourite = true
                        }
                    })
            );
        } else {
            resolve();
        }
    })
        .then(() => {
            res.render('quizzes/play', {
                quiz,
                answer,
                cloudinary
            });
        })
        .catch(error => next(error));
    };


// GET /quizzes/:quizId/check
exports.check = (req, res, next) => {

    const {quiz, query} = req;

    const answer = query.answer || "";
    const result = answer.toLowerCase().trim() === quiz.answer.toLowerCase().trim();

    res.render('quizzes/result', {
        quiz,
        result,
        answer
    });
};

/*
GET /quizzes/randomPlay0

It is chosen how many quizzes to be played.

 */

exports.randomplay0 = (req, res ,next) => {

    req.session.Nquizzes = 0;
    let Nquizzes = req.session.Nquizzes;

    // If there have been playing before, it is started again.
    if (req.session.randomPlay) {
        req.session.randomPlay = [];
    }

    models.quiz.findAll()
        .then(quizzes => {
            req.session.Nquizzes = quizzes.length;
            Nquizzes = req.session.Nquizzes;
         })
        .then(() => {
            res.render('quizzes/randomPlay0',{
                Nquizzes
            })
        })
        .catch(error => next(error))
};

/*
* randomplay muestra una pregunta al azar en el formulario del view random_play
*
* Para ello:
*
* 1) Se crea un array con las ids preguntas de la BBDD.
* 2) Se consulta la BBDD y se saca los ids de las que faltan por contestar.
* 3) Se pasa el quiz al formulario
*
 */
// GET /quizzes/randomplay
exports.randomplay = (req, res, next) => {

    const {query} = req;

    // In each loop if its the query, you stored, if not its pick the previous value.

    req.session.NquizzesPlaying = query.NquizzesPlaying || req.session.NquizzesPlaying ;
    let NquizzesPlaying =  req.session.NquizzesPlaying ;

    // It is validated the value.

    if ((NquizzesPlaying <= 0) || (NquizzesPlaying > req.session.Nquizzes)){
        res.redirect('/quizzes/randomPlay0');
        req.flash(`error`, `You have not chosen a valid number of quizzes to play.`)
    }

    // 1) Se crea un array con las ids preguntas de la BBDD.
    req.session.randomPlay = req.session.randomPlay || [];

    const score0 = req.session.randomPlay.length;

// 2) Se consulta la BBDD y se saca los ids de las que faltan por contestar.
    const whereOpt = {'id': {[Sequelize.Op.notIn]: req.session.randomPlay}};
    models.quiz.count({where: whereOpt})
        .then(function (count) {
            return models.quiz.findAll({
                where: whereOpt,
                offset: Math.floor(Math.random() * count),
                limit: 1
            })
        })
        // 3) Se pasa el quiz al formulario
        .then(function (quizzes) {

            // If the played are more than the desired, show no more.

            const score = req.session.randomPlay.length;

            if(quizzes[0] && (score < NquizzesPlaying) ) {

                // As it is desired render not only the quiz but the info about tips and
                // author, it is include this values in the find.

                models.quiz.findById(quizzes[0].id, {
                    include: [
                        {
                            model: models.attachment
                        },
                        {
                            model: models.tip,
                            include: [
                                {
                                    model: models.user, as: 'author'
                                }
                            ]
                        },
                        {
                            model: models.user, as: 'author'
                        }
                    ]
                })
                .then(quiz => {
                    if (quiz) {
                        req.quiz = quiz;
                        res.render('quizzes/random_play', {
                            quiz,
                            score: req.session.randomPlay.length,
                            cloudinary
                        })
                    } else {
                        throw new Error('There is no quiz with id =' + quizId);
                    }
                })
                 .catch(error => next(error));


            } else {
                req.session.randomPlay = [];
                res.render('quizzes/random_nomore', { //Index random cehck tal
                    score: score0
                })

            }

        })
        .catch(error => next(error))
};


/*
* randomcheck muestra si la respuesta es correcta en el formulario.
*
* 1) Comprueba si la respuesta que obtiene de la BBDD guardada en req.query
* es la misma de la que aparece en el formulario.
* 2) Si es correcto se sigue jugando hasta que se acaben las preguntas.
* 3) Si es incorrecto se muestra el view random_nomore
*
*/
// GET /quizzes/:quizId/randomcheck
exports.randomcheck = (req, res, next) => {

    // 1) Comprueba si la respuesta que obtiene de la BBDD guardada en req.query
    // es la misma de la que aparece en el formulario.
    const answer = req.query.answer || "";
    const result  = answer.toLowerCase().trim() === req.quiz.answer.toLowerCase().trim() ;

    if (result){
        req.session.randomPlay.push(req.quiz.id);
    }
    //else{
    //  delete req.session.randomPlay;
    //}

    const score = req.session.randomPlay.length;
    res.render('quizzes/random_result', {answer, result, score});

    if (!result) {
        delete req.session.randomPlay;
    }
 // if (!result || (req.session.randomPlay.length > req.session.NrandomPlay)) {
 //        delete req.session.randomPlay;
 //    }
};
